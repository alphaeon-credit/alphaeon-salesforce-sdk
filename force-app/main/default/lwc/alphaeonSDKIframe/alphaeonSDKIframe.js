import { LightningElement, api, wire } from "lwc";
import { getRecord } from "lightning/uiRecordApi";
import getClientConfig from "@salesforce/apex/AlphaeonSDKController.getClientConfig";

const VF_PATH = "/apex/AlphaeonSDK";

const PRACTICE_TARGETS = new Set(["locationName", "locationId"]);

// Salesforce IDs encode their SObject in the first three characters; this map
// lets the LWC auto-detect the placement's type so admins don't have to keep
// the SObject Type property in sync with the record page they drop onto.
const KEY_PREFIX_TO_SOBJECT = {
  "001": "Account",
  "003": "Contact"
};

function sobjectFromRecordId(recordId) {
  if (typeof recordId !== "string" || recordId.length < 3) return null;
  return KEY_PREFIX_TO_SOBJECT[recordId.slice(0, 3)] || null;
}

function applyTransform(raw, transform) {
  if (raw == null) return null;
  const s = String(raw);
  switch (transform) {
    case "digits_only":
      return s.replace(/\D/g, "");
    case "last_4_digits":
      return s.replace(/\D/g, "").slice(-4);
    case "first_5_digits":
      // Handles zip+4 ("94110-1234"), spaces, and pre-stripped ("94110").
      return s.replace(/\D/g, "").slice(0, 5);
    case "first_word": {
      const parts = s.trim().split(/\s+/);
      return parts[0] || "";
    }
    case "last_word": {
      const parts = s.trim().split(/\s+/);
      return parts[parts.length - 1] || "";
    }
    case "lowercase":
      return s.toLowerCase();
    case "uppercase":
      return s.toUpperCase();
    case "trim":
      return s.trim();
    default:
      return s;
  }
}

/**
 * Hosts the Alphaeon JS SDK inside a Visualforce iframe and pushes the currently
 * selected record's details into it via postMessage. Field-to-SDK-property mapping
 * is driven by Alphaeon_Field_Mapping__mdt records, so admins can adapt to org
 * data models (custom SSN/DOB/location fields, alternate phone fields, etc.)
 * without redeploying the LWC.
 */
export default class AlphaeonSDKIframe extends LightningElement {
  /** Auto-populated on a Lightning record page. */
  @api
  get recordId() {
    return this._recordId;
  }
  set recordId(v) {
    this._recordId = v;
    this._rebuildFieldList();
  }

  /** Which SDK component to render. */
  @api componentType = "customer_status:merchant:badge";

  /** DeveloperName of the Alphaeon_Config__mdt record to use. */
  @api configDeveloperName = "Default";

  /** Optional per-placement environment override ('sandbox' | 'production'). */
  @api environmentOverride;

  /** SObject this placement targets (Account, Contact). Drives which mapping
   *  records apply and which fields the LWC fetches. */
  @api sobjectType = "Account";

  /** iframe height in pixels. */
  @api iframeHeight = 50;

  account;
  errorMessage;
  environmentLabel;
  notConfigured = false;
  overlayActive = false;

  _recordId;
  _mappings = [];
  _accountFields = [];
  _vfOrigin = null;
  _pendingPayload = null;
  _onMessage;

  /** Effective SObject for this placement: prefer the recordId's prefix-derived
   *  type (always correct when present), falling back to the @api property for
   *  AppPage/HomePage placements or unrecognized prefixes. */
  get resolvedSobjectType() {
    return sobjectFromRecordId(this._recordId) || this.sobjectType || "Account";
  }

  _rebuildFieldList() {
    const sob = this.resolvedSobjectType.toLowerCase();
    this._accountFields = (this._mappings || [])
      .filter(
        (m) => (m.sObjectName || "").toLowerCase() === sob && m.sourceField
      )
      .map((m) => `${this.resolvedSobjectType}.${m.sourceField}`);
  }

  // --- Lifecycle -------------------------------------------------------------
  connectedCallback() {
    this._onMessage = this.handleMessage.bind(this);
    window.addEventListener("message", this._onMessage);
  }

  disconnectedCallback() {
    window.removeEventListener("message", this._onMessage);
  }

  // --- Data ------------------------------------------------------------------
  @wire(getClientConfig, { configDeveloperName: "$configDeveloperName" })
  wiredConfig({ data, error }) {
    if (data) {
      this.environmentLabel = (
        this.environmentOverride ||
        data.environment ||
        ""
      ).toLowerCase();
      this.notConfigured = !data.configured;
      this._mappings = data.mappings || [];
      this._rebuildFieldList();
    } else if (error) {
      this.environmentLabel = (this.environmentOverride || "").toLowerCase();
    }
  }

  // optionalFields (not fields): if a configured field doesn't exist in the
  // org or the running user lacks FLS, LDS silently omits it instead of
  // failing the whole batch — important since this LWC shares its query with
  // any other component on the same page.
  @wire(getRecord, { recordId: "$recordId", optionalFields: "$_accountFields" })
  wiredAccount({ data, error }) {
    // The wire fires once with an empty field list before config loads; skip
    // until we actually have mappings.
    if (!this._accountFields || this._accountFields.length === 0) {
      return;
    }
    if (data) {
      this.account = data;
      this.errorMessage = undefined;
      this.pushAccountToFrame();
    } else if (error) {
      // LDS consolidates getRecord requests across every component subscribed
      // to the same recordId; a single bad field on another component (or in
      // the page layout) fails the shared query and surfaces here even when
      // our own requests are optional. Log for diagnostics but proceed with
      // an empty payload so the SDK still renders and prompts the user.
      // eslint-disable-next-line no-console
      console.warn(
        "AlphaeonSDKIframe: LDS getRecord error (continuing with empty payload)",
        this.reduceError(error)
      );
      this.account = { fields: {} };
      this.errorMessage = undefined;
      this.pushAccountToFrame();
    }
  }

  // --- iframe ----------------------------------------------------------------
  get iframeSrc() {
    let url = `${VF_PATH}?cfg=${encodeURIComponent(this.configDeveloperName || "Default")}`;
    if (this.environmentOverride) {
      url += `&env=${encodeURIComponent(this.environmentOverride)}`;
    }
    return url;
  }

  get frameStyle() {
    if (this.overlayActive) {
      return "position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:9999;border:none;background:#fff;";
    }
    const h = parseInt(this.iframeHeight, 10) || 50;
    return `width:100%;height:${h}px;border:none;`;
  }

  get showConfigWarning() {
    return this.notConfigured === true;
  }

  // --- Messaging -------------------------------------------------------------
  handleMessage(event) {
    const msg = event && event.data;
    if (!msg || msg.source !== "alphaeon-vf") {
      return;
    }

    // Only trust messages that originate from our own iframe's window.
    const frame = this.template.querySelector("iframe");
    if (!frame || event.source !== frame.contentWindow) {
      return;
    }

    if (msg.type === "alphaeon:ready") {
      // Trust and remember the iframe's origin; reply only to it from now on.
      this._vfOrigin = event.origin;
      this.pushAccountToFrame();
      return;
    }

    // Only accept follow-up events from the origin we already trust.
    if (event.origin !== this._vfOrigin) {
      return;
    }

    // Expand the iframe to a full-viewport overlay while the SDK's modal is
    // up; otherwise its UI is clipped to the inline placement. Only collapse
    // on the SDK's onClose: onComplete fires while the modal is still open on
    // its confirmation screen (e.g. after sending an OTA), so collapsing there
    // squeezes the still-open modal into the inline strip.
    const sdkEventType =
      msg.type === "alphaeon:event" && msg.data ? msg.data.type : null;
    if (sdkEventType === "modal_opened") {
      this.overlayActive = true;
    } else if (msg.type === "alphaeon:close") {
      this.overlayActive = false;
    }

    this.dispatchEvent(
      new CustomEvent("alphaeonevent", {
        detail: { type: msg.type, data: msg.data }
      })
    );
  }

  pushAccountToFrame() {
    const payload = this.buildPayload();
    if (!payload) {
      return;
    }
    const frame = this.template.querySelector("iframe");
    if (frame && frame.contentWindow && this._vfOrigin) {
      frame.contentWindow.postMessage(
        { type: "alphaeon:render", payload },
        this._vfOrigin
      );
      this._pendingPayload = null;
    } else {
      // Frame not ready yet; it will be flushed when "ready" arrives.
      this._pendingPayload = payload;
    }
  }

  buildPayload() {
    if (!this.account || !this._mappings) {
      return null;
    }
    const customerData = {};
    const practiceData = {};

    const sob = this.resolvedSobjectType.toLowerCase();
    for (const m of this._mappings) {
      if ((m.sObjectName || "").toLowerCase() !== sob) continue;
      const target = m.targetField;
      if (!target || !m.sourceField) continue;
      const cell =
        this.account.fields && this.account.fields[m.sourceField]
          ? this.account.fields[m.sourceField]
          : null;
      const raw = cell ? cell.value : null;
      if (raw == null || raw === "") continue;
      const value = applyTransform(raw, m.transformName);
      if (value == null || value === "") continue;
      // First non-empty mapping for a given target wins, so an ordered chain
      // like Billing-then-Shipping postal code degrades gracefully.
      const bucket = PRACTICE_TARGETS.has(target) ? practiceData : customerData;
      if (bucket[target] == null || bucket[target] === "") {
        bucket[target] = value;
      }
    }

    return {
      componentType: this.componentType,
      customerData,
      practiceData
    };
  }

  // --- Utils -----------------------------------------------------------------
  reduceError(error) {
    if (Array.isArray(error.body)) {
      return error.body.map((e) => e.message).join(", ");
    } else if (error.body && typeof error.body.message === "string") {
      return error.body.message;
    }
    return "Unable to load account details.";
  }
}
