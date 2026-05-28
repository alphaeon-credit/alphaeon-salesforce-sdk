import { createElement } from "lwc";
import AlphaeonSDKIframe from "c/alphaeonSDKIframe";
import { getRecord } from "lightning/uiRecordApi";
import getClientConfig from "@salesforce/apex/AlphaeonSDKController.getClientConfig";

// Mock the Apex config method as a wire adapter so the test can emit data.
jest.mock(
  "@salesforce/apex/AlphaeonSDKController.getClientConfig",
  () => {
    const {
      createApexTestWireAdapter
    } = require("@salesforce/sfdx-lwc-jest");
    return { default: createApexTestWireAdapter(jest.fn()) };
  },
  { virtual: true }
);

const DEFAULT_MAPPINGS = [
  {
    sObjectName: "Account",
    sourceField: "Phone",
    targetField: "mobilePhone",
    transformName: "digits_only"
  },
  {
    sObjectName: "Account",
    sourceField: "BillingPostalCode",
    targetField: "zip",
    transformName: "none"
  },
  {
    sObjectName: "Account",
    sourceField: "ShippingPostalCode",
    targetField: "zip",
    transformName: "none"
  },
  {
    sObjectName: "Account",
    sourceField: "Name",
    targetField: "locationName",
    transformName: "none"
  }
];

const ACCOUNT_RECORD = {
  apiName: "Account",
  fields: {
    Name: { value: "Acme Eye Care" },
    Phone: { value: "(555) 123-4567" },
    BillingPostalCode: { value: "90210" },
    ShippingPostalCode: { value: null }
  }
};

function flushPromises() {
  return Promise.resolve();
}

function emitConfig(mappings = DEFAULT_MAPPINGS) {
  getClientConfig.emit({
    clientId: "abc",
    environment: "sandbox",
    configured: true,
    mappings
  });
}

describe("c-alphaeon-s-d-k-iframe", () => {
  afterEach(() => {
    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild);
    }
    jest.clearAllMocks();
  });

  it("renders the Visualforce iframe with the config query param", () => {
    const element = createElement("c-alphaeon-s-d-k-iframe", {
      is: AlphaeonSDKIframe
    });
    element.configDeveloperName = "Default";
    document.body.appendChild(element);

    const iframe = element.shadowRoot.querySelector("iframe");
    expect(iframe).not.toBeNull();
    expect(iframe.src).toContain("/apex/AlphaeonSDK");
    expect(iframe.src).toContain("cfg=Default");
  });

  it("includes the environment override in the iframe src when set", () => {
    const element = createElement("c-alphaeon-s-d-k-iframe", {
      is: AlphaeonSDKIframe
    });
    element.environmentOverride = "production";
    document.body.appendChild(element);

    const iframe = element.shadowRoot.querySelector("iframe");
    expect(iframe.src).toContain("env=production");
  });

  it("expands to a full-viewport overlay while the SDK modal is open", async () => {
    const element = createElement("c-alphaeon-s-d-k-iframe", {
      is: AlphaeonSDKIframe
    });
    document.body.appendChild(element);

    const iframe = element.shadowRoot.querySelector("iframe");
    const fakeWindow = { postMessage: jest.fn() };
    Object.defineProperty(iframe, "contentWindow", {
      value: fakeWindow,
      configurable: true
    });

    const origin = "https://example--c.vf.force.com";
    const dispatch = (data) => {
      const ev = new MessageEvent("message", { data, origin });
      Object.defineProperty(ev, "source", {
        value: fakeWindow,
        configurable: true
      });
      window.dispatchEvent(ev);
    };

    dispatch({ source: "alphaeon-vf", type: "alphaeon:ready" });
    await flushPromises();
    expect(iframe.getAttribute("style")).not.toContain("position:fixed");

    dispatch({
      source: "alphaeon-vf",
      type: "alphaeon:event",
      data: { type: "modal_opened" }
    });
    await flushPromises();
    expect(iframe.getAttribute("style")).toContain("position:fixed");
    expect(iframe.getAttribute("style")).toContain("100vw");

    dispatch({ source: "alphaeon-vf", type: "alphaeon:exit", data: null });
    await flushPromises();
    expect(iframe.getAttribute("style")).not.toContain("position:fixed");

    dispatch({
      source: "alphaeon-vf",
      type: "alphaeon:event",
      data: { type: "modal_opened" }
    });
    await flushPromises();
    expect(iframe.getAttribute("style")).toContain("position:fixed");
    dispatch({
      source: "alphaeon-vf",
      type: "alphaeon:event",
      data: { type: "modal_closed" }
    });
    await flushPromises();
    expect(iframe.getAttribute("style")).not.toContain("position:fixed");
  });

  it("posts mapped account data to the iframe after a ready handshake", async () => {
    const element = createElement("c-alphaeon-s-d-k-iframe", {
      is: AlphaeonSDKIframe
    });
    element.recordId = "001000000000001AAA";
    document.body.appendChild(element);

    // Config first so the LWC knows which Account fields to fetch.
    emitConfig();
    await flushPromises();

    // Now provide the wired record.
    getRecord.emit(ACCOUNT_RECORD);
    await flushPromises();

    const iframe = element.shadowRoot.querySelector("iframe");
    const postSpy = jest.fn();
    const fakeWindow = { postMessage: postSpy };
    Object.defineProperty(iframe, "contentWindow", {
      value: fakeWindow,
      configurable: true
    });

    const readyEvent = new MessageEvent("message", {
      data: { source: "alphaeon-vf", type: "alphaeon:ready" },
      origin: "https://example--c.vf.force.com"
    });
    Object.defineProperty(readyEvent, "source", {
      value: fakeWindow,
      configurable: true
    });
    window.dispatchEvent(readyEvent);
    await flushPromises();

    expect(postSpy).toHaveBeenCalledTimes(1);
    const [message, targetOrigin] = postSpy.mock.calls[0];
    expect(targetOrigin).toBe("https://example--c.vf.force.com");
    expect(message.type).toBe("alphaeon:render");
    // Phone digits only, zip from BillingPostalCode (shipping is empty -> skipped),
    // name -> locationName.
    expect(message.payload.customerData.mobilePhone).toBe("5551234567");
    expect(message.payload.customerData.zip).toBe("90210");
    expect(message.payload.practiceData.locationName).toBe("Acme Eye Care");
  });

  it("applies the last_4_digits transform for SSN-like fields", async () => {
    const element = createElement("c-alphaeon-s-d-k-iframe", {
      is: AlphaeonSDKIframe
    });
    element.recordId = "001000000000001AAA";
    document.body.appendChild(element);

    emitConfig([
      {
        sObjectName: "Account",
        sourceField: "Last4Ssn__c",
        targetField: "last4Ssn",
        transformName: "last_4_digits"
      }
    ]);
    await flushPromises();

    getRecord.emit({
      apiName: "Account",
      fields: {
        Last4Ssn__c: { value: "123-45-6789" }
      }
    });
    await flushPromises();

    const iframe = element.shadowRoot.querySelector("iframe");
    const postSpy = jest.fn();
    const fakeWindow = { postMessage: postSpy };
    Object.defineProperty(iframe, "contentWindow", {
      value: fakeWindow,
      configurable: true
    });

    const readyEvent = new MessageEvent("message", {
      data: { source: "alphaeon-vf", type: "alphaeon:ready" },
      origin: "https://example--c.vf.force.com"
    });
    Object.defineProperty(readyEvent, "source", {
      value: fakeWindow,
      configurable: true
    });
    window.dispatchEvent(readyEvent);
    await flushPromises();

    expect(postSpy).toHaveBeenCalledTimes(1);
    const [message] = postSpy.mock.calls[0];
    expect(message.payload.customerData.last4Ssn).toBe("6789");
  });

  it("auto-detects Contact from the recordId prefix even when sobjectType is left at Account", async () => {
    const element = createElement("c-alphaeon-s-d-k-iframe", {
      is: AlphaeonSDKIframe
    });
    // 003 prefix => Contact. Admin forgot to flip the SObject Type property.
    element.recordId = "003000000000001AAA";
    document.body.appendChild(element);

    emitConfig([
      {
        sObjectName: "Account",
        sourceField: "Phone",
        targetField: "mobilePhone",
        transformName: "digits_only"
      },
      {
        sObjectName: "Contact",
        sourceField: "MobilePhone",
        targetField: "mobilePhone",
        transformName: "digits_only"
      }
    ]);
    await flushPromises();

    getRecord.emit({
      apiName: "Contact",
      fields: {
        MobilePhone: { value: "(415) 555-9876" }
      }
    });
    await flushPromises();

    const iframe = element.shadowRoot.querySelector("iframe");
    const postSpy = jest.fn();
    Object.defineProperty(iframe, "contentWindow", {
      value: { postMessage: postSpy },
      configurable: true
    });

    const readyEvent = new MessageEvent("message", {
      data: { source: "alphaeon-vf", type: "alphaeon:ready" },
      origin: "https://example--c.vf.force.com"
    });
    Object.defineProperty(readyEvent, "source", {
      value: iframe.contentWindow,
      configurable: true
    });
    window.dispatchEvent(readyEvent);
    await flushPromises();

    const [message] = postSpy.mock.calls[0];
    expect(message.payload.customerData.mobilePhone).toBe("4155559876");
  });

  it("uses Contact mappings when sobjectType is Contact", async () => {
    const element = createElement("c-alphaeon-s-d-k-iframe", {
      is: AlphaeonSDKIframe
    });
    element.recordId = "003000000000001AAA";
    element.sobjectType = "Contact";
    document.body.appendChild(element);

    // Mappings span both SObjects; only the Contact ones should apply.
    emitConfig([
      {
        sObjectName: "Account",
        sourceField: "Phone",
        targetField: "mobilePhone",
        transformName: "digits_only"
      },
      {
        sObjectName: "Contact",
        sourceField: "MobilePhone",
        targetField: "mobilePhone",
        transformName: "digits_only"
      },
      {
        sObjectName: "Contact",
        sourceField: "FirstName",
        targetField: "firstName",
        transformName: "none"
      },
      {
        sObjectName: "Contact",
        sourceField: "LastName",
        targetField: "lastName",
        transformName: "none"
      }
    ]);
    await flushPromises();

    getRecord.emit({
      apiName: "Contact",
      fields: {
        MobilePhone: { value: "(415) 555-9876" },
        FirstName: { value: "Jane" },
        LastName: { value: "Doe" }
      }
    });
    await flushPromises();

    const iframe = element.shadowRoot.querySelector("iframe");
    const postSpy = jest.fn();
    Object.defineProperty(iframe, "contentWindow", {
      value: { postMessage: postSpy },
      configurable: true
    });

    const readyEvent = new MessageEvent("message", {
      data: { source: "alphaeon-vf", type: "alphaeon:ready" },
      origin: "https://example--c.vf.force.com"
    });
    Object.defineProperty(readyEvent, "source", {
      value: iframe.contentWindow,
      configurable: true
    });
    window.dispatchEvent(readyEvent);
    await flushPromises();

    const [message] = postSpy.mock.calls[0];
    expect(message.payload.customerData.mobilePhone).toBe("4155559876");
    expect(message.payload.customerData.firstName).toBe("Jane");
    expect(message.payload.customerData.lastName).toBe("Doe");
  });

  it("applies first_5_digits, first_word, and last_word transforms", async () => {
    const element = createElement("c-alphaeon-s-d-k-iframe", {
      is: AlphaeonSDKIframe
    });
    element.recordId = "001000000000001AAA";
    document.body.appendChild(element);

    emitConfig([
      {
        sObjectName: "Account",
        sourceField: "BillingPostalCode",
        targetField: "zip",
        transformName: "first_5_digits"
      },
      {
        sObjectName: "Account",
        sourceField: "Name",
        targetField: "firstName",
        transformName: "first_word"
      },
      {
        sObjectName: "Account",
        sourceField: "Name",
        targetField: "lastName",
        transformName: "last_word"
      }
    ]);
    await flushPromises();

    getRecord.emit({
      apiName: "Account",
      fields: {
        Name: { value: "  John Quincy Adams  " },
        BillingPostalCode: { value: "94110-1234" }
      }
    });
    await flushPromises();

    const iframe = element.shadowRoot.querySelector("iframe");
    const postSpy = jest.fn();
    const fakeWindow = { postMessage: postSpy };
    Object.defineProperty(iframe, "contentWindow", {
      value: fakeWindow,
      configurable: true
    });

    const readyEvent = new MessageEvent("message", {
      data: { source: "alphaeon-vf", type: "alphaeon:ready" },
      origin: "https://example--c.vf.force.com"
    });
    Object.defineProperty(readyEvent, "source", {
      value: fakeWindow,
      configurable: true
    });
    window.dispatchEvent(readyEvent);
    await flushPromises();

    const [message] = postSpy.mock.calls[0];
    expect(message.payload.customerData.zip).toBe("94110");
    expect(message.payload.customerData.firstName).toBe("John");
    expect(message.payload.customerData.lastName).toBe("Adams");
  });

  it("falls back to the next mapping when the first source field is empty", async () => {
    const element = createElement("c-alphaeon-s-d-k-iframe", {
      is: AlphaeonSDKIframe
    });
    element.recordId = "001000000000001AAA";
    document.body.appendChild(element);

    emitConfig();
    await flushPromises();
    getRecord.emit({
      apiName: "Account",
      fields: {
        Name: { value: "Acme" },
        Phone: { value: null },
        BillingPostalCode: { value: null },
        ShippingPostalCode: { value: "94110" }
      }
    });
    await flushPromises();

    const iframe = element.shadowRoot.querySelector("iframe");
    const postSpy = jest.fn();
    Object.defineProperty(iframe, "contentWindow", {
      value: { postMessage: postSpy },
      configurable: true
    });

    const readyEvent = new MessageEvent("message", {
      data: { source: "alphaeon-vf", type: "alphaeon:ready" },
      origin: "https://example--c.vf.force.com"
    });
    Object.defineProperty(readyEvent, "source", {
      value: iframe.contentWindow,
      configurable: true
    });
    window.dispatchEvent(readyEvent);
    await flushPromises();

    const [message] = postSpy.mock.calls[0];
    expect(message.payload.customerData.zip).toBe("94110");
    expect(message.payload.customerData.mobilePhone).toBeUndefined();
  });
});
