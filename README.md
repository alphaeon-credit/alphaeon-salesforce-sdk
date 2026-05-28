# Alphaeon Salesforce SDK

A Salesforce DX project that embeds the [Alphaeon JS SDK](https://alphaeon-credit.github.io/AlphaeonJS/)
into Lightning Experience as a configurable Lightning Web Component on
**Account** and **Contact** record pages.

## How it works

```
Lightning record page
└── alphaeonSDKIframe (LWC)
    └── /apex/AlphaeonSDK (Visualforce iframe, separate origin)
        └── Alphaeon JS SDK (sdk.alphaeon.com)
            └── Alphaeon bridge iframe
```

- The **LWC** reads Account/Contact fields via Lightning Data Service,
  applies admin-configured field mappings, and posts the result to the
  Visualforce iframe.
- The **Visualforce page** loads the Alphaeon SDK script in its own origin
  (avoiding Lightning Web Security restrictions on third-party JS) and
  brokers postMessage between the LWC and the SDK.
- The **field mapping engine** is driven by `Alphaeon_Field_Mapping__mdt`
  custom metadata records, so admins can wire up org-specific custom
  fields (mobile, SSN last-4, DOB, location id, etc.) without redeploying
  the LWC.

## Setup

See **[INSTALLATION.md](INSTALLATION.md)** for the full walkthrough:
prerequisites, deploy, credential configuration, page placement,
troubleshooting.

## Project layout

| Path | Purpose |
| --- | --- |
| `force-app/main/default/lwc/alphaeonSDKIframe/` | LWC placed on record pages |
| `force-app/main/default/pages/AlphaeonSDK.page` | Visualforce iframe that loads the Alphaeon JS SDK |
| `force-app/main/default/classes/AlphaeonSDKController*` | Apex controller + tests |
| `force-app/main/default/objects/Alphaeon_Config__mdt/` | Per-org config (Client Id, Client Key, env, baseUrl) |
| `force-app/main/default/objects/Alphaeon_Field_Mapping__mdt/` | SObject → SDK property mappings |
| `force-app/main/default/customMetadata/Alphaeon_Field_Mapping.Default_*` | Seed mappings (Account + Contact) |
| `force-app/main/default/cspTrustedSites/` | CSP whitelist entries for Alphaeon hosts |

## Development

```
npm install            # one-time
npm test               # LWC jest tests
sf project deploy start --source-dir force-app --target-org <alias>
sf apex run test --class-names AlphaeonSDKControllerTest --target-org <alias>
```

Prettier and ESLint run via Husky on commit (`npm run precommit`).
