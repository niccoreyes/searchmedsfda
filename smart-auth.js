/**
 * SMART on FHIR Authentication Module for Rx Builder
 * Supports: Medplum, SMART Health IT, Epic, Cerner, and custom providers
 */

(function () {
  'use strict';

  // Configuration loaded from smart-config.json
  let PROVIDER_CONFIGS = {};
  let APP_SETTINGS = {};
  let currentProvider = null;

  // Default configuration (fallback)
  const SMART_CONFIG = {
    baseUrl: '',
    fhirUrl: '',
    authorizeUrl: '',
    tokenUrl: '',
    clientId: '',
    redirectUri: '',
    scopes: []
  };

  // Storage keys
  const STORAGE_TOKEN = 'smart_access_token';
  const STORAGE_REFRESH = 'smart_refresh_token';
  const STORAGE_EXPIRES = 'smart_token_expires';
  const STORAGE_PATIENT = 'smart_patient_id';
  const STORAGE_ENCOUNTER = 'smart_encounter_id';
  const STORAGE_PRACTITIONER = 'smart_practitioner_id';
  const STORAGE_CLIENT_ID = 'smart_client_id';
  const STORAGE_PROVIDER_KEY = 'smart_provider_key';
  const STORAGE_LAUNCH_CONTEXT = 'smart_launch_context';
  const STORAGE_CODE_VERIFIER = 'smart_code_verifier';
  const STORAGE_STATE = 'smart_state';

  // State
  let accessToken = null;
  let patientId = null;
  let practitionerId = null;
  let encounterId = null;
  let fhirClient = null;
  let isInitialized = false;
  let ehrLaunchConfig = null; // Stores discovered config from EHR launch

  /**
   * Load provider configuration
   */
  async function loadProviderConfig() {
    try {
      const response = await fetch('smart-config.json');
      if (!response.ok) {
        throw new Error('Failed to load smart-config.json');
      }
      const config = await response.json();
      PROVIDER_CONFIGS = config.providers || {};
      APP_SETTINGS = config.settings || {};
    } catch (error) {
      console.warn('[SMART] Could not load smart-config.json, using defaults:', error);
      // Fallback to minimal config
      PROVIDER_CONFIGS = {
        medplum: {
          name: 'Medplum',
          baseUrl: 'https://api.medplum.com',
          fhirUrl: 'https://api.medplum.com/fhir/R4',
          authorizeUrl: 'https://api.medplum.com/oauth2/authorize',
          tokenUrl: 'https://api.medplum.com/oauth2/token',
          clientId: '',
          scopes: ['openid', 'fhirUser', 'profile', 'launch/patient', 'patient/Patient.read', 'patient/Patient.write']
        }
      };
    }
  }

  /**
   * Get provider configuration by key
   */
  function getProviderConfig(key) {
    return PROVIDER_CONFIGS[key] || null;
  }

  /**
   * Apply provider configuration to SMART_CONFIG
   */
  function applyProviderConfig(providerKey, customClientId = null) {
    const config = getProviderConfig(providerKey);
    if (!config) {
      console.error('[SMART] Unknown provider:', providerKey);
      return false;
    }

    currentProvider = providerKey;

    // Apply base configuration
    SMART_CONFIG.baseUrl = config.baseUrl;
    SMART_CONFIG.fhirUrl = config.fhirUrl;
    SMART_CONFIG.authorizeUrl = config.authorizeUrl;
    SMART_CONFIG.tokenUrl = config.tokenUrl;
    SMART_CONFIG.scopes = [...config.scopes];

    // Client ID priority: custom > localStorage > config file default
    const savedClientId = localStorage.getItem(STORAGE_CLIENT_ID);
    SMART_CONFIG.clientId = customClientId || savedClientId || config.clientId || '';

    // Store provider selection
    localStorage.setItem(STORAGE_PROVIDER_KEY, providerKey);

    return true;
  }

  /**
   * Initialize SMART on FHIR
   * Check for existing session or handle callback from auth
   */
  async function initSMART() {
    // Load configuration
    await loadProviderConfig();

    // Set redirect URI to current origin
    SMART_CONFIG.redirectUri = window.location.origin + window.location.pathname;

    // Check URL parameters for EHR launch
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');
    const state = urlParams.get('state');
    const error = urlParams.get('error');
    const launch = urlParams.get('launch');
    const iss = urlParams.get('iss');

    // Handle OAuth errors
    if (error) {
      console.error('[SMART] OAuth error:', error, urlParams.get('error_description'));
      clearAuthData();
      return { success: false, error: error, errorDescription: urlParams.get('error_description') };
    }

    // Handle OAuth callback
    if (code && state) {
      return await handleCallback(code, state);
    }

    // Handle EHR launch (SMART Health IT, Epic, Cerner, etc.)
    if (launch && iss) {
      return await initiateEhrLaunch(launch, iss);
    }

    // Check for existing session
    const existingToken = localStorage.getItem(STORAGE_TOKEN);
    const expiresAt = localStorage.getItem(STORAGE_EXPIRES);
    const savedPatient = localStorage.getItem(STORAGE_PATIENT);
    const savedPractitioner = localStorage.getItem(STORAGE_PRACTITIONER);
    const savedProvider = localStorage.getItem(STORAGE_PROVIDER_KEY);

    if (existingToken && expiresAt && Date.now() < parseInt(expiresAt)) {
      // Restore provider configuration if available
      if (savedProvider && getProviderConfig(savedProvider)) {
        applyProviderConfig(savedProvider);
      }

      accessToken = existingToken;
      patientId = savedPatient;
      practitionerId = savedPractitioner;
      encounterId = localStorage.getItem(STORAGE_ENCOUNTER);
      isInitialized = true;

      initFhirClient();
      return { success: true, fromStorage: true, provider: savedProvider };
    }

    return { success: false, reason: 'no_session' };
  }

  /**
   * Initiate SMART authorization flow with provider selection
   */
  async function authorize(providerKey = null, customClientId = null) {
    // If provider specified, use it
    if (providerKey && getProviderConfig(providerKey)) {
      applyProviderConfig(providerKey, customClientId);
    }

    // If no client ID configured, prompt user
    if (!SMART_CONFIG.clientId && APP_SETTINGS.promptForClientId !== false) {
      const clientId = prompt(`Enter your ${currentProvider || 'SMART on FHIR'} Client ID:`);
      if (!clientId) {
        return { success: false, error: 'no_client_id' };
      }
      SMART_CONFIG.clientId = clientId;
      localStorage.setItem(STORAGE_CLIENT_ID, clientId);
    }

    // For EHR launches (like SMART Health IT), use discovered endpoints
    let authorizeUrl = SMART_CONFIG.authorizeUrl;
    let tokenUrl = SMART_CONFIG.tokenUrl;
    let fhirUrl = SMART_CONFIG.fhirUrl;

    // If we discovered config from EHR launch, use those
    if (ehrLaunchConfig) {
      authorizeUrl = ehrLaunchConfig.authorization_endpoint;
      tokenUrl = ehrLaunchConfig.token_endpoint;
      if (ehrLaunchConfig.issuer) {
        fhirUrl = ehrLaunchConfig.issuer;
      }
      // Store discovered endpoints for token exchange
      SMART_CONFIG.tokenUrl = tokenUrl;
      SMART_CONFIG.fhirUrl = fhirUrl;
    }

    if (!authorizeUrl) {
      return { success: false, error: 'no_authorize_url', message: 'Authorization URL not configured' };
    }

    // Generate state and PKCE verifier
    const state = generateRandomString(32);
    const codeVerifier = generateRandomString(64);
    const codeChallenge = await pkceChallengeFromVerifier(codeVerifier);

    // Store PKCE verifier for callback
    sessionStorage.setItem(STORAGE_CODE_VERIFIER, codeVerifier);
    sessionStorage.setItem(STORAGE_STATE, state);

    // Build authorization URL
    const authUrl = new URL(authorizeUrl);
    authUrl.searchParams.set('response_type', 'code');

    // Only set client_id if we have one (SMART Health IT public apps may not need one)
    if (SMART_CONFIG.clientId) {
      authUrl.searchParams.set('client_id', SMART_CONFIG.clientId);
    }

    authUrl.searchParams.set('redirect_uri', SMART_CONFIG.redirectUri);
    authUrl.searchParams.set('scope', SMART_CONFIG.scopes.join(' '));
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('code_challenge', codeChallenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');

    // Set audience (required by some servers)
    if (fhirUrl) {
      authUrl.searchParams.set('aud', fhirUrl);
    }

    // Add launch context if available
    const launchContext = localStorage.getItem(STORAGE_LAUNCH_CONTEXT);
    if (launchContext) {
      authUrl.searchParams.set('launch', launchContext);
    }

    console.log('[SMART] Initiating authorization to:', authorizeUrl);
    console.log('[SMART] Redirect URI:', SMART_CONFIG.redirectUri);

    // Redirect to authorization server
    window.location.href = authUrl.toString();
  }

  /**
   * Initiate EHR launch flow (SMART Health IT, Epic, Cerner)
   */
  async function initiateEhrLaunch(launch, iss) {
    try {
      console.log('[SMART] EHR Launch detected:', { launch, iss });

      // Discover SMART configuration from iss
      const smartConfig = await discoverSmartConfig(iss);

      if (smartConfig) {
        console.log('[SMART] Discovered SMART configuration:', smartConfig);
        ehrLaunchConfig = smartConfig;

        // Update SMART_CONFIG with discovered endpoints
        SMART_CONFIG.authorizeUrl = smartConfig.authorization_endpoint;
        SMART_CONFIG.tokenUrl = smartConfig.token_endpoint;
        SMART_CONFIG.fhirUrl = smartConfig.issuer || iss;

        // Store discovered FHIR base URL
        SMART_CONFIG.baseUrl = iss.replace(/\/$/, '');
      } else {
        // Fallback: assume standard endpoints
        SMART_CONFIG.fhirUrl = iss;
        SMART_CONFIG.baseUrl = iss.replace(/\/fhir\/R4$/, '').replace(/\/$/, '');
      }

      // Store launch context
      localStorage.setItem(STORAGE_LAUNCH_CONTEXT, launch);

      // Try to match issuer to a known provider
      let matchedProvider = null;
      for (const [key, config] of Object.entries(PROVIDER_CONFIGS)) {
        if (config.fhirUrl && iss.includes(config.fhirUrl.replace(/^https?:\/\//, '').split('/')[0])) {
          matchedProvider = key;
          break;
        }
      }

      // If no match and it's SMART Health IT
      if (!matchedProvider && iss.includes('launch.smarthealthit.org')) {
        matchedProvider = 'smarthealthit';
      }

      if (matchedProvider) {
        applyProviderConfig(matchedProvider);
      } else {
        // Unknown provider - will prompt for client ID
        currentProvider = 'custom';
        SMART_CONFIG.scopes = ['openid', 'fhirUser', 'launch', 'launch/patient', 'patient/*.read', 'patient/*.write'];
      }

      // Proceed with authorization
      return await authorize();
    } catch (error) {
      console.error('[SMART] EHR launch failed:', error);
      return { success: false, error: 'ehr_launch_failed', message: error.message };
    }
  }

  /**
   * Discover SMART configuration from FHIR server
   */
  async function discoverSmartConfig(iss) {
    try {
      const wellKnownUrl = `${iss.replace(/\/$/, '')}/.well-known/smart-configuration`;
      console.log('[SMART] Discovering from:', wellKnownUrl);

      const response = await fetch(wellKnownUrl);
      if (!response.ok) {
        throw new Error(`Discovery failed: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      console.error('[SMART] Discovery failed:', error);
      return null;
    }
  }

  /**
   * Handle OAuth callback
   */
  async function handleCallback(code, state) {
    // Verify state
    const savedState = sessionStorage.getItem(STORAGE_STATE);
    if (state !== savedState) {
      console.error('[SMART] State mismatch');
      return { success: false, error: 'state_mismatch' };
    }

    const codeVerifier = sessionStorage.getItem(STORAGE_CODE_VERIFIER);
    if (!codeVerifier) {
      console.error('[SMART] No code verifier found');
      return { success: false, error: 'no_code_verifier' };
    }

    // Determine token URL
    let tokenUrl = SMART_CONFIG.tokenUrl;

    // If this was an EHR launch, we may need to use the discovered token endpoint
    if (!tokenUrl && ehrLaunchConfig) {
      tokenUrl = ehrLaunchConfig.token_endpoint;
    }

    if (!tokenUrl) {
      // Try to restore from session or use default
      const savedProvider = localStorage.getItem(STORAGE_PROVIDER_KEY);
      if (savedProvider && getProviderConfig(savedProvider)) {
        tokenUrl = getProviderConfig(savedProvider).tokenUrl;
      }
    }

    if (!tokenUrl) {
      return { success: false, error: 'no_token_url', message: 'Token URL not configured' };
    }

    try {
      // Build token request
      const tokenParams = new URLSearchParams({
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: SMART_CONFIG.redirectUri,
        code_verifier: codeVerifier
      });

      // Only include client_id if we have one
      if (SMART_CONFIG.clientId) {
        tokenParams.set('client_id', SMART_CONFIG.clientId);
      }

      // Exchange code for token
      const tokenResponse = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: tokenParams
      });

      if (!tokenResponse.ok) {
        const errorData = await tokenResponse.text();
        throw new Error(`Token exchange failed: ${tokenResponse.status} - ${errorData}`);
      }

      const tokenData = await tokenResponse.json();

      // Store tokens
      accessToken = tokenData.access_token;
      const expiresIn = tokenData.expires_in || 3600;
      const expiresAt = Date.now() + (expiresIn * 1000);

      localStorage.setItem(STORAGE_TOKEN, accessToken);
      localStorage.setItem(STORAGE_EXPIRES, expiresAt.toString());

      if (tokenData.refresh_token) {
        localStorage.setItem(STORAGE_REFRESH, tokenData.refresh_token);
      }

      // Extract context from token response
      if (tokenData.patient) {
        patientId = tokenData.patient;
        localStorage.setItem(STORAGE_PATIENT, patientId);
        console.log('[SMART] Patient from token response:', patientId);
      }

      if (tokenData.encounter) {
        encounterId = tokenData.encounter;
        localStorage.setItem(STORAGE_ENCOUNTER, encounterId);
      }

      if (tokenData.fhirUser) {
        practitionerId = tokenData.fhirUser.split('/').pop();
        localStorage.setItem(STORAGE_PRACTITIONER, practitionerId);
      }

      // Decode id_token for additional context
      if (tokenData.id_token) {
        try {
          const payload = decodeJwtPayload(tokenData.id_token);
          console.log('[SMART] ID token payload:', payload);

          if (payload.patient && !patientId) {
            patientId = payload.patient;
            localStorage.setItem(STORAGE_PATIENT, patientId);
          }

          if (payload.profile && !practitionerId) {
            const ref = payload.profile;
            if (ref.startsWith('Practitioner/')) {
              practitionerId = ref.split('/')[1];
              localStorage.setItem(STORAGE_PRACTITIONER, practitionerId);
            }
          }
        } catch (e) {
          console.error('[SMART] Failed to decode id_token:', e);
        }
      }

      // Check access token JWT for patient context
      if (accessToken && !patientId) {
        try {
          const payload = decodeJwtPayload(accessToken);
          if (payload) {
            if (payload.patient) {
              patientId = payload.patient;
              localStorage.setItem(STORAGE_PATIENT, patientId);
            }
            if (payload.launch_patient) {
              patientId = payload.launch_patient;
              localStorage.setItem(STORAGE_PATIENT, patientId);
            }
          }
        } catch (e) {
          console.error('[SMART] Failed to decode access token:', e);
        }
      }

      // Clean up URL and session storage
      const cleanUrl = window.location.origin + window.location.pathname;
      window.history.replaceState({}, document.title, cleanUrl);

      sessionStorage.removeItem(STORAGE_CODE_VERIFIER);
      sessionStorage.removeItem(STORAGE_STATE);

      // Initialize FHIR client
      initFhirClient();
      isInitialized = true;

      return { success: true, patient: patientId, practitioner: practitionerId };
    } catch (error) {
      console.error('[SMART] Token exchange failed:', error);
      return { success: false, error: 'token_exchange_failed', message: error.message };
    }
  }

  /**
   * Initialize FHIR client with current access token
   */
  function initFhirClient() {
    fhirClient = {
      baseUrl: SMART_CONFIG.fhirUrl,
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/fhir+json',
        'Accept': 'application/fhir+json'
      }
    };
  }

  /**
   * Refresh access token
   */
  async function refreshToken() {
    const refreshToken = localStorage.getItem(STORAGE_REFRESH);
    if (!refreshToken) {
      return false;
    }

    try {
      const tokenParams = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken
      });

      if (SMART_CONFIG.clientId) {
        tokenParams.set('client_id', SMART_CONFIG.clientId);
      }

      const response = await fetch(SMART_CONFIG.tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: tokenParams
      });

      if (!response.ok) {
        throw new Error('Refresh failed');
      }

      const tokenData = await response.json();
      accessToken = tokenData.access_token;
      const expiresIn = tokenData.expires_in || 3600;
      const expiresAt = Date.now() + (expiresIn * 1000);

      localStorage.setItem(STORAGE_TOKEN, accessToken);
      localStorage.setItem(STORAGE_EXPIRES, expiresAt.toString());

      if (tokenData.refresh_token) {
        localStorage.setItem(STORAGE_REFRESH, tokenData.refresh_token);
      }

      initFhirClient();
      return true;
    } catch (error) {
      console.error('[SMART] Token refresh failed:', error);
      clearAuthData();
      return false;
    }
  }

  /**
   * Fetch FHIR resource
   */
  async function fetchResource(resourceType, id) {
    if (!fhirClient) {
      throw new Error('FHIR client not initialized');
    }

    const url = `${fhirClient.baseUrl}/${resourceType}/${id}`;
    const response = await fetch(url, {
      headers: fhirClient.headers
    });

    if (!response.ok) {
      if (response.status === 401) {
        const refreshed = await refreshToken();
        if (refreshed) {
          return fetchResource(resourceType, id);
        }
      }
      throw new Error(`FHIR request failed: ${response.status}`);
    }

    return await response.json();
  }

  /**
   * Search FHIR resources
   */
  async function searchResource(resourceType, params = {}) {
    if (!fhirClient) {
      throw new Error('FHIR client not initialized');
    }

    const url = new URL(`${fhirClient.baseUrl}/${resourceType}`);
    Object.entries(params).forEach(([key, value]) => {
      url.searchParams.set(key, value);
    });

    const response = await fetch(url.toString(), {
      headers: fhirClient.headers
    });

    if (!response.ok) {
      if (response.status === 401) {
        const refreshed = await refreshToken();
        if (refreshed) {
          return searchResource(resourceType, params);
        }
      }
      throw new Error(`FHIR search failed: ${response.status}`);
    }

    return await response.json();
  }

  /**
   * Create FHIR resource
   */
  async function createResource(resource) {
    if (!fhirClient) {
      throw new Error('FHIR client not initialized');
    }

    const url = `${fhirClient.baseUrl}/${resource.resourceType}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: fhirClient.headers,
      body: JSON.stringify(resource)
    });

    if (!response.ok) {
      if (response.status === 401) {
        const refreshed = await refreshToken();
        if (refreshed) {
          return createResource(resource);
        }
      }
      const errorText = await response.text();
      throw new Error(`FHIR create failed: ${response.status} - ${errorText}`);
    }

    return await response.json();
  }

  /**
   * Update FHIR resource
   */
  async function updateResource(resource) {
    if (!fhirClient) {
      throw new Error('FHIR client not initialized');
    }

    const url = `${fhirClient.baseUrl}/${resource.resourceType}/${resource.id}`;
    const response = await fetch(url, {
      method: 'PUT',
      headers: fhirClient.headers,
      body: JSON.stringify(resource)
    });

    if (!response.ok) {
      if (response.status === 401) {
        const refreshed = await refreshToken();
        if (refreshed) {
          return updateResource(resource);
        }
      }
      throw new Error(`FHIR update failed: ${response.status}`);
    }

    return await response.json();
  }

  /**
   * Get current patient
   */
  async function getPatient() {
    if (!patientId) {
      throw new Error('No patient context');
    }
    return await fetchResource('Patient', patientId);
  }

  /**
   * Get current practitioner
   */
  async function getPractitioner() {
    if (practitionerId) {
      return await fetchResource('Practitioner', practitionerId);
    }

    // Try to decode access token JWT to get profile claim
    if (accessToken) {
      const payload = decodeJwtPayload(accessToken);
      if (payload && payload.profile) {
        const ref = payload.profile;
        if (typeof ref === 'string' && ref.startsWith('Practitioner/')) {
          practitionerId = ref.split('/')[1];
          localStorage.setItem(STORAGE_PRACTITIONER, practitionerId);
          return await fetchResource('Practitioner', practitionerId);
        }
      }
    }

    throw new Error('No practitioner context');
  }

  /**
   * Load practitioner info for prescription prefill
   */
  async function loadPractitionerInfo() {
    try {
      const practitioner = await getPractitioner();

      // Extract name
      let name = '';
      if (practitioner.name && practitioner.name.length > 0) {
        const officialName = practitioner.name.find(n => n.use === 'official') || practitioner.name[0];
        const given = officialName.given ? officialName.given.join(' ') : '';
        const family = officialName.family || '';
        const prefix = officialName.prefix ? officialName.prefix.join(' ') : '';
        const suffix = officialName.suffix ? officialName.suffix.join(' ') : '';
        name = [prefix, given, family, suffix].filter(Boolean).join(' ');
      }

      // Extract identifier (PRC license)
      let prcNumber = '';
      if (practitioner.identifier) {
        const prcIdentifier = practitioner.identifier.find(id =>
          id.system?.includes('prc') ||
          id.type?.coding?.some(c => c.code === 'PRC')
        );
        if (prcIdentifier) {
          prcNumber = prcIdentifier.value;
        }
      }

      // Extract telecom
      let phone = '';
      let email = '';
      if (practitioner.telecom) {
        const phoneContact = practitioner.telecom.find(t => t.system === 'phone');
        const emailContact = practitioner.telecom.find(t => t.system === 'email');
        phone = phoneContact?.value || '';
        email = emailContact?.value || '';
      }

      return {
        id: practitioner.id,
        name: name,
        prcNumber: prcNumber,
        phone: phone,
        email: email,
        resource: practitioner
      };
    } catch (error) {
      console.error('[SMART] Failed to load practitioner:', error);
      throw error;
    }
  }

  /**
   * Create MedicationRequest from prescription item
   */
  async function createMedicationRequest(prescriptionData, patientIdOverride = null) {
    const targetPatientId = patientIdOverride || patientId;

    if (!targetPatientId) {
      throw new Error('No patient context for medication request');
    }

    const medicationText = prescriptionData.brandName
      ? `${prescriptionData.genericName} (${prescriptionData.brandName})`
      : prescriptionData.genericName;

    const medicationRequest = {
      resourceType: 'MedicationRequest',
      status: 'active',
      intent: 'order',
      subject: {
        reference: `Patient/${targetPatientId}`
      },
      medicationCodeableConcept: {
        text: medicationText
      },
      dosageInstruction: prescriptionData.sig ? [{ text: prescriptionData.sig }] : undefined,
      dispenseRequest: prescriptionData.qty ? {
        quantity: {
          value: parseInt(prescriptionData.qty) || prescriptionData.qty,
          unit: prescriptionData.form || 'units'
        }
      } : undefined
    };

    if (practitionerId) {
      medicationRequest.requester = {
        reference: `Practitioner/${practitionerId}`
      };
    }

    if (encounterId) {
      medicationRequest.encounter = {
        reference: `Encounter/${encounterId}`
      };
    }

    return await createResource(medicationRequest);
  }

  /**
   * Submit full prescription as Bundle
   */
  async function submitPrescriptionBundle(prescriptionItems) {
    if (!patientId) {
      throw new Error('No patient context');
    }

    const entries = prescriptionItems.map((item, index) => ({
      fullUrl: `urn:uuid:med-${index}`,
      request: {
        method: 'POST',
        url: 'MedicationRequest'
      },
      resource: buildMedicationRequest(item, index)
    }));

    const bundle = {
      resourceType: 'Bundle',
      type: 'transaction',
      entry: entries
    };

    const response = await fetch(`${fhirClient.baseUrl}/`, {
      method: 'POST',
      headers: fhirClient.headers,
      body: JSON.stringify(bundle)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Bundle submission failed: ${response.status} - ${errorText}`);
    }

    return await response.json();
  }

  /**
   * Build MedicationRequest resource from item
   */
  function buildMedicationRequest(item, index) {
    const medicationText = item.brandName
      ? `${item.genericName} (${item.brandName})`
      : item.genericName;

    const dosageText = [item.strength, item.form, item.sig]
      .filter(Boolean)
      .join(' ');

    const medRequest = {
      resourceType: 'MedicationRequest',
      status: 'active',
      intent: 'order',
      subject: {
        reference: `Patient/${patientId}`
      },
      medicationCodeableConcept: {
        text: medicationText
      },
      dosageInstruction: dosageText ? [{ text: dosageText }] : undefined,
      dispenseRequest: item.qty ? {
        quantity: {
          value: parseInt(item.qty) || item.qty,
          unit: item.form || 'units'
        }
      } : undefined
    };

    if (practitionerId) {
      medRequest.requester = {
        reference: `Practitioner/${practitionerId}`
      };
    }

    if (encounterId) {
      medRequest.encounter = {
        reference: `Encounter/${encounterId}`
      };
    }

    return medRequest;
  }

  /**
   * Clear all authentication data
   */
  function clearAuthData() {
    accessToken = null;
    patientId = null;
    practitionerId = null;
    encounterId = null;
    fhirClient = null;
    isInitialized = false;
    ehrLaunchConfig = null;

    localStorage.removeItem(STORAGE_TOKEN);
    localStorage.removeItem(STORAGE_REFRESH);
    localStorage.removeItem(STORAGE_EXPIRES);
    localStorage.removeItem(STORAGE_PATIENT);
    localStorage.removeItem(STORAGE_ENCOUNTER);
    localStorage.removeItem(STORAGE_PRACTITIONER);
    localStorage.removeItem(STORAGE_LAUNCH_CONTEXT);
    // Keep STORAGE_PROVIDER_KEY and STORAGE_CLIENT_ID for convenience
  }

  /**
   * Logout - clear all SMART data
   */
  function logout() {
    clearAuthData();
    localStorage.removeItem(STORAGE_PROVIDER_KEY);
    localStorage.removeItem(STORAGE_CLIENT_ID);
  }

  /**
   * Check if authenticated
   */
  function isAuthenticated() {
    return isInitialized && accessToken !== null;
  }

  /**
   * Get current context
   */
  function getContext() {
    return {
      patientId,
      practitionerId,
      encounterId,
      isAuthenticated: isAuthenticated(),
      provider: currentProvider,
      fhirUrl: SMART_CONFIG.fhirUrl
    };
  }

  /**
   * Get available providers
   */
  function getAvailableProviders() {
    return Object.entries(PROVIDER_CONFIGS).map(([key, config]) => ({
      key,
      name: config.name,
      requiresClientId: !config.clientId,
      isOpen: config.isOpen || false
    }));
  }

  /**
   * Set patient ID manually
   */
  function setPatient(id) {
    patientId = id;
    if (id) {
      localStorage.setItem(STORAGE_PATIENT, id);
    } else {
      localStorage.removeItem(STORAGE_PATIENT);
    }
  }

  /**
   * Search for patients by name or identifier
   */
  async function searchPatients(searchText) {
    if (!fhirClient) {
      throw new Error('FHIR client not initialized');
    }

    const params = {};
    if (searchText) {
      params.name = searchText;
    }

    return await searchResource('Patient', params);
  }

  // ============ Utility Functions ============

  function generateRandomString(length) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  async function pkceChallengeFromVerifier(verifier) {
    const encoder = new TextEncoder();
    const data = encoder.encode(verifier);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return base64URLEncode(digest);
  }

  function base64URLEncode(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
  }

  /**
   * Decode JWT payload without verification
   */
  function decodeJwtPayload(token) {
    try {
      const base64Url = token.split('.')[1];
      const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
      const jsonPayload = decodeURIComponent(
        atob(base64)
          .split('')
          .map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
          .join('')
      );
      return JSON.parse(jsonPayload);
    } catch (e) {
      console.error('[SMART] Failed to decode JWT:', e);
      return null;
    }
  }

  // ============ Export Public API ============

  window.SMARTAuth = {
    init: initSMART,
    authorize,
    logout,
    isAuthenticated,
    getContext,
    getPatient,
    getPractitioner,
    loadPractitionerInfo,
    setPatient,
    searchPatients,
    createMedicationRequest,
    submitPrescriptionBundle,
    fetchResource,
    searchResource,
    createResource,
    updateResource,
    getAvailableProviders,
    applyProviderConfig,
    config: SMART_CONFIG
  };

})();
