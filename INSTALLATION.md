# Installing the Alphaeon SDK into Salesforce

This guide walks through deploying the project to a Salesforce org (sandbox
or production), configuring the Alphaeon credentials, and dropping the LWC
onto an Account record page. Plan on ~15 minutes the first time.

---

## 1. Prerequisites

- **Salesforce CLI** (`sf`) installed. Verify:
  ```
  sf --version
  ```
  If missing, install: <https://developer.salesforce.com/tools/salesforcecli>.
- A target org with **Modify Metadata** permission for your user (any sandbox
  or scratch org; or production if you're ready).
- Your **Alphaeon Client Id** and **Client Key** (sandbox or production).
  Contact Alphaeon if you don't have them.

---

## 2. Authenticate to the target org

A browser-based login is easiest. Use `test.salesforce.com` for sandboxes,
`login.salesforce.com` for production.

```
# Sandbox
sf org login web --instance-url https://test.salesforce.com --alias alphaeon-sandbox

# Production
sf org login web --instance-url https://login.salesforce.com --alias alphaeon-prod
```

The alias (`alphaeon-sandbox` / `alphaeon-prod`) is what every later command
will reference.

---

## 3. Deploy the source

From the repo root:

```
sf project deploy start --source-dir force-app --target-org alphaeon-sandbox
```

This deploys the following components:

| Type             | Name                                          | Purpose                                                              |
| ---------------- | --------------------------------------------- | -------------------------------------------------------------------- |
| CustomObject     | `Alphaeon_Config__mdt` (+ 4 fields)           | Custom metadata type that holds Client Id, Client Key, env, base URL |
| CustomObject     | `Alphaeon_Field_Mapping__mdt` (+ 6 fields)    | Custom metadata type that maps SObject fields to SDK properties      |
| CustomMetadata   | `Alphaeon_Config.Default`                     | The default config record (placeholders until step 4)                |
| CustomMetadata   | `Alphaeon_Field_Mapping.Default_*` (×10)      | Seed mappings for Account and Contact (see step 4c)                  |
| ApexClass        | `AlphaeonSDKController` (+ `…Test`)           | Visualforce controller and its test                                  |
| ApexPage         | `AlphaeonSDK`                                 | Visualforce page that hosts the Alphaeon JS SDK script               |
| LightningComponentBundle | `alphaeonSDKIframe`                  | The Lightning Web Component placed on record pages                   |
| CspTrustedSite   | `Alphaeon_Sandbox`, `Alphaeon_Production`     | Allows the browser to load `*.alphaeontest.com` / `*.alphaeon.com`   |

If the deploy fails with `UNKNOWN_EXCEPTION` and no per-component errors,
see [Troubleshooting](#troubleshooting) — that means a single bad file is
masking the rest of the bundle.

> **Note on tests in production.** When deploying to production Salesforce
> requires all tests to pass. Use `--test-level RunLocalTests` and ensure
> `AlphaeonSDKControllerTest` passes in your org.

---

## 4. Configure the Alphaeon Config record

The `Default` record ships with placeholder values. Replace them with your
real credentials.

### 4a. Add the custom fields to the page layout (one-time)

Custom metadata types don't show their custom fields on the edit page until
the fields are added to the layout.

1. Setup → Quick Find → **Custom Metadata Types**.
2. Click the **Alphaeon Config** label (the link itself, not "Manage Records").
3. Scroll to **Page Layouts** → next to the existing layout click **Edit**.
4. Drag the four fields from the palette into the layout:
   - Client Id
   - Client Key
   - Environment
   - Base Url
5. **Save**.

### 4b. Edit the Default record

1. Setup → **Custom Metadata Types** → next to **Alphaeon Config** click
   **Manage Records**.
2. On the **Default** row click **Edit**.
3. Fill in:
   - **Client Id** — your Alphaeon Client Id
   - **Client Key** — your Alphaeon Client Key
   - **Environment** — `sandbox` or `production`
   - **Base Url** — leave **blank** unless Alphaeon tells you to override
     the SDK's default bridge host. See the
     [bridge-host workaround](#sandbox-bridge-host-doesnt-resolve) if you
     hit "Bridge boot timed out" in the sandbox.
4. **Save**.

> Rotating credentials later? Just edit this record — no redeploy needed.
> The Client Key is read server-side by the Visualforce controller and is
> never sent to the LWC, so it stays out of the browser DOM.

> **Why your settings survive deploys.** The repo's `.forceignore` excludes
> `Alphaeon_Config.Default.md-meta.xml`, so `sf project deploy start` skips
> that record on every subsequent deploy. Edit credentials in the UI and
> they stay put across `--source-dir force-app` deploys.
>
> First-time bootstrap on a fresh org needs the record to exist before the
> ignore can protect it. Two options:
>
> 1. **Temporarily un-ignore for the first deploy** — comment out the
>    `Alphaeon_Config.Default.md-meta.xml` line in `.forceignore`, run the
>    initial `sf project deploy start`, then restore the line.
> 2. **Create the record manually in Setup** before any deploys — Setup →
>    Custom Metadata Types → next to **Alphaeon Config** click **Manage
>    Records** → **New** → name it `Default`, then fill in the four fields
>    (after adding them to the page layout — see step 4a).
>
> The `.forceignore` only excludes the `Default` record. New configs you
> create (`Production`, `Tenant_X`, etc.) aren't affected — they live only
> in the org unless you choose to commit them to source.

### 4c. (Optional) Customize the SObject → SDK field mappings

The LWC's payload is driven by `Alphaeon_Field_Mapping__mdt` records, so you
can wire up custom fields (mobile, SSN last-4, DOB, location id) without
touching code. Each mapping is scoped to one SObject; the LWC's
**SObject Type** property (set in App Builder) selects which mappings apply
to a given placement. Defaults that ship on the `Default` config:

**Account placements** (SObject Type = `Account`):

| Source                       | Target (SDK property)         | Transform     | Priority |
| ---------------------------- | ----------------------------- | ------------- | -------- |
| `Account.Phone`              | `mobilePhone` (customerData)  | `digits_only` | 10       |
| `Account.BillingPostalCode`  | `zip` (customerData, primary) | `none`        | 10       |
| `Account.ShippingPostalCode` | `zip` (customerData, fallback)| `none`        | 20       |
| `Account.Name`               | `locationName` (practiceData) | `none`        | 10       |

**Contact placements** (SObject Type = `Contact`):

| Source                       | Target (SDK property)          | Transform        | Priority |
| ---------------------------- | ------------------------------ | ---------------- | -------- |
| `Contact.MobilePhone`        | `mobilePhone` (primary)        | `digits_only`    | 10       |
| `Contact.Phone`              | `mobilePhone` (fallback)       | `digits_only`    | 20       |
| `Contact.MailingPostalCode`  | `zip` (customerData)           | `first_5_digits` | 10       |
| `Contact.FirstName`          | `firstName` (customerData)     | `none`           | 10       |
| `Contact.LastName`           | `lastName` (customerData)      | `none`           | 10       |

> `Contact.Birthdate` isn't shipped as a default because its availability
> varies by org (FLS, deletion, custom replacements). Add a mapping for
> `Birthdate` → `dateOfBirth` if your org exposes the field.

Conflict rule: when two mappings target the same SDK property, the lowest
**Priority** value wins for non-empty source values; ties break by
DeveloperName. Mappings without a Priority set sort last.

To add a mapping (e.g., your org stores SSN's last four in
`Account.Last4Ssn__c`):

1. Setup → **Custom Metadata Types** → next to **Alphaeon Field Mapping**
   click **Manage Records** → **New**.
2. Add the fields to the layout first if they're not visible (same trick as
   step 4a, but on the `Alphaeon Field Mapping` type).
3. Fill in:
   - **Label** / **Name**: anything (e.g. `Default Last4Ssn`)
   - **Alphaeon Config**: `Default`
   - **SObject**: `Account`
   - **Source Field**: API name of the SF field, e.g. `Last4Ssn__c`
   - **Target Field**: pick `last4Ssn`
   - **Transform**: pick `last_4_digits` (strips non-digits and keeps the
     last 4 — works whether the SF field stores `1234`, `123-45-6789`, or
     anything in between)
   - **Priority**: `10` if this is the only/primary mapping for `last4Ssn`;
     larger numbers (`20`, `30`, …) for explicit fallbacks. Leave blank to
     accept lowest priority (mappings without a Priority sort last).
4. **Save**. The next page load picks up the new mapping; no redeploy.

Available transforms:

| Transform        | Effect                                                                                  | Example                              |
| ---------------- | --------------------------------------------------------------------------------------- | ------------------------------------ |
| `none`           | pass-through                                                                            | `Acme` → `Acme`                      |
| `digits_only`    | strip every non-digit character                                                         | `(555) 123-4567` → `5551234567`      |
| `last_4_digits`  | strip non-digits, keep the last four (SSN)                                              | `123-45-6789` → `6789`               |
| `first_5_digits` | strip non-digits, keep the first five (zip+4 → zip)                                     | `94110-1234` → `94110`               |
| `first_word`     | first whitespace-delimited token of the trimmed value                                   | `John Quincy Adams` → `John`         |
| `last_word`      | last whitespace-delimited token of the trimmed value                                    | `John Quincy Adams` → `Adams`        |
| `lowercase`      | lowercase the whole string                                                              | `Acme` → `acme`                      |
| `uppercase`      | uppercase the whole string                                                              | `Acme` → `ACME`                      |
| `trim`           | remove leading/trailing whitespace                                                      | `  Acme  ` → `Acme`                  |

Available target fields: `mobilePhone`, `zip`, `last4Ssn`, `dateOfBirth`,
`firstName`, `lastName`, `locationName`, `locationId`.

> The LWC supports `Account` and `Contact` placements today. To extend to
> other SObjects (Lead, Opportunity, custom objects), add the SObject to
> the `<datasource>` and `<objects>` lists in `alphaeonSDKIframe.js-meta.xml`
> and redeploy the LWC.

---

## 5. Grant Visualforce page access

The LWC loads `/apex/AlphaeonSDK` inside its iframe. The running user's
profile needs access to that page.

1. Setup → Quick Find → **Visualforce Pages**.
2. Next to **AlphaeonSDK** click **Security**.
3. Move every profile that should see the component from **Available
   Profiles** to **Enabled Profiles**.
4. **Save**.

If you skip this, the iframe loads a "Insufficient Privileges" page or just
renders blank.

---

## 6. Add the component to a Lightning page

1. Open any record of a supported type — **Account** or **Contact**.
2. Header → gear icon → **Edit Page**. Lightning App Builder opens.
3. In the left **Components** panel, scroll to **Custom** and drag
   **Alphaeon SDK Iframe** onto the layout.
4. With the component selected, set the properties on the right:
   - **SDK Component Type** — e.g. `customer_status:merchant:badge`
     (default), `checkout:merchant:button`, etc. See Alphaeon's SDK docs.
   - **Config Developer Name** — `Default` unless you've created a
     non-default record.
   - **SObject Type** — `Account` or `Contact`. Hint for AppPage/HomePage
     placements where there's no recordId. On a record page the LWC
     auto-detects from the recordId's key-prefix (`001` → Account, `003`
     → Contact), so this property can be left at its default on
     Account/Contact record pages.
   - **Environment Override** — leave blank to use the record's
     `Environment` value; set to `sandbox` / `production` to force one.
   - **Iframe Height (px)** — `50` (default) is sized for the inline badge.
     The component auto-expands to full-viewport when the SDK opens its
     modal, so this only sets the inline placement size; bump it for
     SDK component types that render taller inline content.
5. Click **Save** → if prompted, **Activate** the page (Org Default is
   simplest; App-and-Profile-specific if you want finer control).
6. Click the back arrow to return to the record. The component should
   render with a "sandbox" badge (or "production") and a brief
   "Waiting for account data…" status before the SDK takes over.

---

## 7. (Optional) Tighten CSP directives

The deployed CSP trusted sites apply broadly by default. If your security
posture requires explicit per-directive flags:

1. Setup → Quick Find → **CSP Trusted Sites**.
2. Click **Alphaeon_Sandbox** (and/or **Alphaeon_Production**) → **Edit**.
3. Check at least:
   - **Script Src**, **Connect Src**, **Frame Src**, **Img Src**,
     **Style Src**, **Font Src**, **Media Src**.
4. **Save**.

These flags can't currently be set via source metadata at API v66 — they
were stripped from this project's source for that reason. Manage them in
the UI for now.

If you've configured the **Base Url** override (step 4b) to point at a host
outside `*.alphaeontest.com` / `*.alphaeon.com` — for example an
`amplifyapp.com` URL — also add a CSP trusted site for that host, otherwise
the bridge iframe may eventually be blocked.

---

## 8. Verify it works

1. Open the Account page where you placed the component.
2. Open browser DevTools (Cmd+Opt+I on Mac, F12 on Windows).
3. Watch the **Console** and **Network** tabs while the page loads.
4. Expected:
   - Network: `GET /apex/AlphaeonSDK?cfg=Default[&env=…]` → 200
   - Network: `GET https://sdk.<env>.alphaeon[test].com/v1/sdk.js` → 200
   - Network: `GET https://<bridge-host>/v1/embed/bridge` → 200 (or a
     status-stream long-poll)
   - Console: no red errors
5. Click the SDK badge — the iframe should expand to cover the page and
   show the credit-status flow.

---

## Troubleshooting

### Deploy fails with `UNKNOWN_EXCEPTION` and 0 components processed

The Metadata API returns this error when a single file in the bundle fails
parsing — and it suppresses the per-component error for the rest of the
bundle. Deploy components in smaller groups to surface the real error:

```
sf project deploy start --source-dir force-app/main/default/cspTrustedSites --target-org <alias>
sf project deploy start --source-dir force-app/main/default/objects        --target-org <alias>
sf project deploy start --source-dir force-app/main/default/customMetadata --target-org <alias>
sf project deploy start --source-dir force-app/main/default/classes --source-dir force-app/main/default/pages --target-org <alias>
sf project deploy start --source-dir force-app/main/default/lwc            --target-org <alias>
```

The Apex class and Visualforce page deploy together because they reference
each other (`Page.AlphaeonSDK` in Apex, `controller="AlphaeonSDKController"`
in VF).

### Component shows but the iframe area is blank

Most likely the running user's profile doesn't have access to the
Visualforce page. Repeat **step 5**.

### `Bridge boot timed out` in DevTools console

The Alphaeon SDK is trying to open its bridge iframe at a host that isn't
reachable. Check the failed `bridge` request in the Network tab.

#### Production works, sandbox doesn't

Confirm the **Environment** value on the active config record is
`sandbox`, and that your Client Id / Client Key are for the sandbox tenant
(they're separate from production credentials).

### `INVALID_FIELD: … No such column 'X' on entity 'Y'` in the console

Lightning Data Service consolidates `getRecord` requests for the same
record across every component on the page. If any other component (or
the page layout) requests a field that doesn't exist or isn't accessible
to the running user, the merged SOQL fails — and every LDS subscriber on
the page receives the error, including this LWC.

The LWC catches these errors and continues with an empty payload so the
SDK still renders, but to clear the underlying issue:

1. Note the offending field name in the error (`Birthdate` in this case).
2. Setup → Object Manager → the affected SObject → Page Layouts; remove
   any references to the missing field, or restore field-level access for
   the running user's profile.
3. Also check related lists, Lightning App Builder components, and any
   custom Aura/LWC components on the page for SOQL referencing that field.
4. If the field is genuinely gone, removing it from the page layout and
   any custom components clears the LDS query failure.

### Component is hidden behind something / appears underneath toasts

The full-viewport overlay uses `z-index: 9999`. Salesforce's utility bar
and toast layer sit higher. If conflict arises during the SDK flow, edit
`alphaeonSDKIframe.js` and raise the `z-index` in the `frameStyle` getter.

### `Refused to frame …` in the console

A CSP Trusted Site is missing or the host isn't covered. Either:
- Add a CSP Trusted Site for the missing host (Setup → CSP Trusted Sites
  → New), or
- If you have a custom **Base Url** pointing at a non-`alphaeon[test].com`
  host, add a CSP Trusted Site for that host as well.

### Browser shields (Brave, uBlock, etc.) blocking the iframe

Brave's Shields and similar extensions can silently block cross-origin
iframes that look like ad/tracker scripts. Symptom: the `bridge` request
fails with `net::ERR_BLOCKED_BY_CLIENT` in DevTools. Disable shields for
the Salesforce domain and the Alphaeon bridge host, or test in plain
Chrome/Safari. Document this in your end-user rollout if your users run
on browsers with aggressive blocking.

---

## File reference

| File                                                                          | Purpose                                                              |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `force-app/main/default/lwc/alphaeonSDKIframe/`                               | The LWC; placed on record pages via App Builder                      |
| `force-app/main/default/pages/AlphaeonSDK.page`                               | Visualforce page that loads the Alphaeon SDK script and brokers events|
| `force-app/main/default/classes/AlphaeonSDKController.cls`                    | Reads the metadata record server-side; exposes a non-secret view to LWC |
| `force-app/main/default/objects/Alphaeon_Config__mdt/`                        | Custom metadata type definition (object + 4 fields)                  |
| `force-app/main/default/objects/Alphaeon_Field_Mapping__mdt/`                 | Custom metadata type for SObject → SDK field mappings                |
| `force-app/main/default/customMetadata/Alphaeon_Config.Default.md-meta.xml`   | Default config record (placeholder credentials)                      |
| `force-app/main/default/customMetadata/Alphaeon_Field_Mapping.Default_*.md-meta.xml` | Default field mapping records (Phone, Name, BillingZip, ShippingZip) |
| `force-app/main/default/cspTrustedSites/Alphaeon_*.cspTrustedSite-meta.xml`   | CSP whitelist entries for Alphaeon hosts                             |
