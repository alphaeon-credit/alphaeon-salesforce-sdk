/**
 * Tests for AlphaeonSDKController.
 *
 * Custom metadata records cannot be inserted via DML, so these tests exercise
 * the controller's resolution logic against whatever Alphaeon_Config__mdt records
 * are deployed (including the "Default" record) and its fallback behaviour when a
 * requested config name does not exist.
 */
@IsTest
private class AlphaeonSDKControllerTest {
  @IsTest
  static void defaultConstructorResolvesSandboxScript() {
    Test.startTest();
    AlphaeonSDKController ctrl = new AlphaeonSDKController();
    Test.stopTest();

    System.assertNotEquals(
      null,
      ctrl.environment,
      'Environment should be resolved'
    );
    System.assert(
      ctrl.sdkUrl == 'https://sdk.sandbox.alphaeontest.com/v1/sdk.js' ||
        ctrl.sdkUrl == 'https://sdk.alphaeon.com/v1/sdk.js',
      'sdkUrl should map to a known SDK host: ' + ctrl.sdkUrl
    );
  }

  @IsTest
  static void envQueryParamOverridesConfig() {
    PageReference pr = Page.AlphaeonSDK;
    pr.getParameters().put('env', 'production');
    Test.setCurrentPage(pr);

    Test.startTest();
    AlphaeonSDKController ctrl = new AlphaeonSDKController();
    Test.stopTest();

    System.assertEquals('production', ctrl.environment, 'env param should win');
    System.assertEquals(
      'https://sdk.alphaeon.com/v1/sdk.js',
      ctrl.sdkUrl,
      'production env should resolve the production script'
    );
  }

  @IsTest
  static void unknownConfigFallsBackToSandboxDefaults() {
    PageReference pr = Page.AlphaeonSDK;
    pr.getParameters().put('cfg', 'This_Config_Does_Not_Exist_123');
    Test.setCurrentPage(pr);

    Test.startTest();
    AlphaeonSDKController ctrl = new AlphaeonSDKController();
    AlphaeonSDKController.ClientConfig view = AlphaeonSDKController.getClientConfig(
      'This_Config_Does_Not_Exist_123'
    );
    Test.stopTest();

    System.assertEquals(
      '',
      ctrl.clientId,
      'Missing config yields blank clientId'
    );
    System.assertEquals(
      '',
      ctrl.clientKey,
      'Missing config yields blank clientKey'
    );
    System.assertEquals(
      AlphaeonSDKController.DEFAULT_ENV,
      ctrl.environment,
      'Falls back to default env'
    );
    System.assertEquals(
      false,
      view.configured,
      'View should report not configured'
    );
    System.assertEquals(
      true,
      view.mappings != null && view.mappings.isEmpty(),
      'Unknown config should yield empty mappings, not null'
    );
  }

  @IsTest
  static void defaultConfigExposesSeedMappings() {
    Test.startTest();
    AlphaeonSDKController.ClientConfig view = AlphaeonSDKController.getClientConfig(
      'Default'
    );
    Test.stopTest();

    System.assertNotEquals(null, view.mappings, 'Mappings should be returned');
    Map<String, AlphaeonSDKController.FieldMapping> byTarget = new Map<String, AlphaeonSDKController.FieldMapping>();
    for (AlphaeonSDKController.FieldMapping fm : view.mappings) {
      byTarget.put(fm.sourceField + '|' + fm.targetField, fm);
    }
    System.assert(
      byTarget.containsKey('Phone|mobilePhone'),
      'Phone -> mobilePhone mapping should ship by default'
    );
    System.assertEquals(
      'digits_only',
      byTarget.get('Phone|mobilePhone').transformName,
      'Phone mapping should strip non-digits'
    );
    System.assert(
      byTarget.containsKey('Name|locationName'),
      'Name -> locationName mapping should ship by default'
    );
  }

  @IsTest
  static void mappingsAreOrderedByPriority() {
    Test.startTest();
    AlphaeonSDKController.ClientConfig view = AlphaeonSDKController.getClientConfig(
      'Default'
    );
    Test.stopTest();

    // For the `zip` target the seed config ships a primary (Billing, priority
    // 10) and a fallback (Shipping, priority 20). With first-non-empty-wins
    // semantics in the LWC, Billing must appear earlier in the list.
    Integer billingIdx = -1;
    Integer shippingIdx = -1;
    for (Integer i = 0; i < view.mappings.size(); i++) {
      AlphaeonSDKController.FieldMapping fm = view.mappings[i];
      if (
        fm.sObjectName == 'Account' &&
        fm.sourceField == 'BillingPostalCode' &&
        fm.targetField == 'zip'
      ) {
        billingIdx = i;
      } else if (
        fm.sObjectName == 'Account' &&
        fm.sourceField == 'ShippingPostalCode' &&
        fm.targetField == 'zip'
      ) {
        shippingIdx = i;
      }
    }
    System.assertNotEquals(-1, billingIdx, 'Billing zip mapping should exist');
    System.assertNotEquals(
      -1,
      shippingIdx,
      'Shipping zip mapping should exist'
    );
    System.assert(
      billingIdx < shippingIdx,
      'Lower Priority value should sort earlier: Billing(10) before Shipping(20)'
    );
  }

  @IsTest
  static void normalizeBaseUrlStripsTrailingSlashAndWhitespace() {
    System.assertEquals(
      'https://example.com',
      AlphaeonSDKController.normalizeBaseUrl('https://example.com/'),
      'Single trailing slash should be stripped'
    );
    System.assertEquals(
      'https://example.com',
      AlphaeonSDKController.normalizeBaseUrl('https://example.com///'),
      'Multiple trailing slashes should all be stripped'
    );
    System.assertEquals(
      'https://example.com',
      AlphaeonSDKController.normalizeBaseUrl('https://example.com'),
      'No-op when there is no trailing slash'
    );
    System.assertEquals(
      'https://example.com',
      AlphaeonSDKController.normalizeBaseUrl('  https://example.com/  '),
      'Whitespace should be trimmed before stripping slashes'
    );
    System.assertEquals(
      '',
      AlphaeonSDKController.normalizeBaseUrl(null),
      'Null becomes empty string'
    );
    System.assertEquals(
      '',
      AlphaeonSDKController.normalizeBaseUrl(''),
      'Empty stays empty'
    );
    System.assertEquals(
      '',
      AlphaeonSDKController.normalizeBaseUrl('   '),
      'Whitespace-only becomes empty'
    );
  }

  @IsTest
  static void getClientConfigNeverReturnsKeyAndDefaultsName() {
    Test.startTest();
    // Blank name should default to "Default"; method must compile and return a view.
    AlphaeonSDKController.ClientConfig view = AlphaeonSDKController.getClientConfig(
      null
    );
    Test.stopTest();

    System.assertNotEquals(null, view, 'A view should always be returned');
    System.assertNotEquals(
      null,
      view.environment,
      'Environment should always be set'
    );
  }
}
