/**
 * Controller for the AlphaeonSDK Visualforce page and the alphaeonSDKIframe LWC.
 *
 * Credentials live in the Alphaeon_Config__mdt custom metadata type so admins can
 * rotate keys without a redeploy. The Visualforce page reads the full config
 * (including the client key) server-side; the LWC only ever receives the
 * non-secret subset via getClientConfig().
 */
public with sharing class AlphaeonSDKController {
  @TestVisible
  private static final String DEFAULT_ENV = 'sandbox';

  // sdk.js script hosts per environment (see Alphaeon installation docs).
  private static final Map<String, String> SDK_URLS = new Map<String, String>{
    'production' => 'https://sdk.alphaeon.com/v1/sdk.js',
    'sandbox' => 'https://sdk.sandbox.alphaeontest.com/v1/sdk.js'
  };

  // --- Visualforce-bound properties (rendered into the page) -----------------
  public String clientId { get; private set; }
  public String clientKey { get; private set; }
  public String environment { get; private set; }
  public String baseUrl { get; private set; }
  public String sdkUrl { get; private set; }

  public AlphaeonSDKController() {
    String devName = 'Default';
    String envParam = null;
    PageReference pr = ApexPages.currentPage();
    if (pr != null) {
      String c = pr.getParameters().get('cfg');
      if (String.isNotBlank(c)) {
        devName = c;
      }
      envParam = pr.getParameters().get('env');
    }

    Alphaeon_Config__mdt cfg = loadConfig(devName);
    this.clientId = cfg != null &&
      cfg.Client_Id__c != null
      ? cfg.Client_Id__c
      : '';
    this.clientKey = cfg != null &&
      cfg.Client_Key__c != null
      ? cfg.Client_Key__c
      : '';
    this.baseUrl = normalizeBaseUrl(cfg != null ? cfg.Base_Url__c : null);

    String env = String.isNotBlank(envParam)
      ? envParam
      : (cfg != null && String.isNotBlank(cfg.Environment__c)
          ? cfg.Environment__c
          : DEFAULT_ENV);
    this.environment = env.toLowerCase();
    this.sdkUrl = SDK_URLS.containsKey(this.environment)
      ? SDK_URLS.get(this.environment)
      : SDK_URLS.get(DEFAULT_ENV);
  }

  // Trim whitespace and any trailing slashes so the SDK can append paths like
  // `${baseUrl}/v1/embed/bridge` without producing `//`.
  @TestVisible
  private static String normalizeBaseUrl(String raw) {
    if (String.isBlank(raw)) {
      return '';
    }
    return raw.trim().replaceFirst('/+$', '');
  }

  private static Alphaeon_Config__mdt loadConfig(String devName) {
    List<Alphaeon_Config__mdt> rows = [
      SELECT Client_Id__c, Client_Key__c, Environment__c, Base_Url__c
      FROM Alphaeon_Config__mdt
      WHERE DeveloperName = :devName
      LIMIT 1
    ];
    return rows.isEmpty() ? null : rows[0];
  }

  /**
   * Non-secret config for the LWC (used for display/diagnostics only).
   * Never returns the client key.
   */
  @AuraEnabled(cacheable=true)
  public static ClientConfig getClientConfig(String configDeveloperName) {
    String devName = String.isBlank(configDeveloperName)
      ? 'Default'
      : configDeveloperName;
    Alphaeon_Config__mdt cfg = loadConfig(devName);
    ClientConfig view = new ClientConfig();
    if (cfg != null) {
      view.clientId = cfg.Client_Id__c;
      view.environment = String.isNotBlank(cfg.Environment__c)
        ? cfg.Environment__c.toLowerCase()
        : DEFAULT_ENV;
      view.configured = String.isNotBlank(cfg.Client_Id__c);
    } else {
      view.environment = DEFAULT_ENV;
      view.configured = false;
    }
    view.mappings = loadMappings(devName);
    return view;
  }

  private static List<FieldMapping> loadMappings(String configDevName) {
    List<FieldMapping> out = new List<FieldMapping>();
    for (Alphaeon_Field_Mapping__mdt m : [
      SELECT
        SObject__c,
        Source_Field__c,
        Target_Field__c,
        Transform__c,
        Priority__c
      FROM Alphaeon_Field_Mapping__mdt
      WHERE Alphaeon_Config__r.DeveloperName = :configDevName
      ORDER BY Priority__c ASC NULLS LAST, DeveloperName ASC
    ]) {
      FieldMapping fm = new FieldMapping();
      fm.sObjectName = m.SObject__c;
      fm.sourceField = m.Source_Field__c;
      fm.targetField = m.Target_Field__c;
      fm.transformName = m.Transform__c;
      fm.priority = m.Priority__c;
      out.add(fm);
    }
    return out;
  }

  public class ClientConfig {
    @AuraEnabled
    public String clientId;
    @AuraEnabled
    public String environment;
    @AuraEnabled
    public Boolean configured;
    @AuraEnabled
    public List<FieldMapping> mappings;
  }

  public class FieldMapping {
    @AuraEnabled
    public String sObjectName;
    @AuraEnabled
    public String sourceField;
    @AuraEnabled
    public String targetField;
    @AuraEnabled
    public String transformName;
    @AuraEnabled
    public Decimal priority;
  }
}
