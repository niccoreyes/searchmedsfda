/**
 * SMART on FHIR Authentication Module for Rx Builder
 * Multi-provider support: Medplum, Aidbox, and custom FHIR servers
 */

(function () {
  'use strict';

  // ============ Provider Registry ============
  const PROVIDERS = {
    medplum: {
      key: 'medplum',
      name: 'Medplum',
      baseUrl: 'https://api.medplum.com',
      fhirUrl: 'https://api.medplum.com/fhir/R4',
      authorizeUrl: 'https://api.medplum.com/oauth2/authorize',
      tokenUrl: 'https://api.medplum.com/oauth2/token',
      discoveryUrl: null, // Uses static URLs
      defaultClientId: '', // Set based on hostname in init
      description: 'Medplum FHIR sandbox'
    },
    aidbox: {
      key: 'aidbox',
      name: 'Aidbox FHIRLab',
      baseUrl: 'https://aidbox.fhirlab.net',
      fhirUrl: 'https://aidbox.fhirlab.net/fhir',
      authorizeUrl: 'https://aidbox.fhirlab.net/auth/authorize',
      tokenUrl: 'https://aidbox.fhirlab.net/auth/token',
      discoveryUrl: 'https://aidbox.fhirlab.net/.well-known/smart-configuration',
      defaultClientId: '',
      description: 'Aidbox FHIRLab sandbox'
    },
    custom: {
      key: 'custom',
      name: 'Custom Server',
      baseUrl: '',
      fhirUrl: '',
      authorizeUrl: '',
      tokenUrl: '',
      discoveryUrl: null,
      defaultClientId: '',
      description: 'Custom SMART on FHIR server'
    }
  };

  // ============ Storage Keys ============
  const STORAGE_PROVIDER = 'smart_provider';
  const STORAGE_CUSTOM_CONFIG = 'smart_custom_config';
  const STORAGE_TOKEN = 'smart_access_token';
  const STORAGE_REFRESH = 'smart_refresh_token';
  const STORAGE_EXPIRES = 'smart_token_expires';
  const STORAGE_PATIENT = 'smart_patient_id';
  const STORAGE_ENCOUNTER = 'smart_encounter_id';
  const STORAGE_PRACTITIONER = 'smart_practitioner_id';
  const STORAGE_LAUNCH_CONTEXT = 'smart_launch_context';
  const STORAGE_CLIENT_ID_LEGACY = 'smart_client_id'; // Legacy for backward compat

  // Get provider-specific client ID key
  function getClientIdKey(providerKey) {
    return `smart_clientId_${providerKey}`;
  }

  // Current provider configuration
  let currentProvider = null;
  let SMART_CONFIG = null;

  // Initialize default SMART config (will be updated based on provider)
  function createSmartConfig(provider) {
    return {
      baseUrl: provider.baseUrl,
      fhirUrl: provider.fhirUrl,
      authorizeUrl: provider.authorizeUrl,
      tokenUrl: provider.tokenUrl,
      clientId: '',
      redirectUri: window.location.origin + window.location.pathname,
      scopes: [
        'openid',
        'fhirUser',
        'profile',
        'launch/patient',
        'patient/Patient.read',
        'patient/Patient.write',
        'patient/Practitioner.read',
        'patient/MedicationRequest.read',
        'patient/MedicationRequest.write',
        'patient/Medication.read'
      ]
    };
  }

  // State
  let accessToken = null;
  let patientId = null;
  let practitionerId = null;
  let encounterId = null;
  let fhirClient = null;
  let isInitialized = false;

  // ============ Provider Management ============

  /**
   * Get the currently selected provider key
   */
  function getCurrentProviderKey() {
    return localStorage.getItem(STORAGE_PROVIDER) || 'medplum';
  }

  /**
   * Set the active provider
   */
  async function setProvider(providerKey, customConfig = null) {
    if (!PROVIDERS[providerKey]) {
      throw new Error(`Unknown provider: ${providerKey}`);
    }

    currentProvider = { ...PROVIDERS[providerKey] };

    // For custom provider, merge in custom config
    if (providerKey === 'custom' && customConfig) {
      currentProvider.baseUrl = customConfig.baseUrl || '';
      currentProvider.fhirUrl = customConfig.fhirUrl || '';
      currentProvider.authorizeUrl = customConfig.authorizeUrl || '';
      currentProvider.tokenUrl = customConfig.tokenUrl || '';
      localStorage.setItem(STORAGE_CUSTOM_CONFIG, JSON.stringify(customConfig));
    }

    // Try SMART discovery for custom servers
    if (providerKey === 'custom' && currentProvider.baseUrl) {
      const discovered = await discoverSmartConfig(currentProvider.baseUrl);
      if (discovered) {
        currentProvider.authorizeUrl = discovered.authorization_endpoint;
        currentProvider.tokenUrl = discovered.token_endpoint;
        currentProvider.fhirUrl = discovered.issuer || currentProvider.baseUrl;
      }
    }

    SMART_CONFIG = createSmartConfig(currentProvider);
    localStorage.setItem(STORAGE_PROVIDER, providerKey);

    // Load saved client ID for this provider
    const savedClientId = localStorage.getItem(getClientIdKey(providerKey));
    if (savedClientId) {
      SMART_CONFIG.clientId = savedClientId;
    }

    // Legacy: check old storage key for medplum
    if (!savedClientId && providerKey === 'medplum') {
      const legacyClientId = localStorage.getItem(STORAGE_CLIENT_ID_LEGACY);
      if (legacyClientId) {
        SMART_CONFIG.clientId = legacyClientId;
        // Migrate to new key
        localStorage.setItem(getClientIdKey('medplum'), legacyClientId);
      }
    }

    // Auto-detect Medplum dev/prod client IDs based on hostname
    if (providerKey === 'medplum' && !SMART_CONFIG.clientId) {
      const hostname = window.location.hostname;
      if (hostname === 'devrxbuilder.vercel.app') {
        SMART_CONFIG.clientId = '217f9e4b-4980-470c-9b09-c1bab39154db';
      }
    }

    return currentProvider;
  }

  /**
   * Get list of available providers
   */
  function getAvailableProviders() {
    return Object.values(PROVIDERS).map(p => ({
      key: p.key,
      name: p.name,
      description: p.description,
      baseUrl: p.baseUrl
    }));
  }

  /**
   * Save client ID for the current provider
   */
  function saveClientId(clientId) {
    if (!currentProvider) return;
    SMART_CONFIG.clientId = clientId;
    localStorage.setItem(getClientIdKey(currentProvider.key), clientId);
  }

  /**
   * Initialize SMART on FHIR
   * Check for existing session or handle callback from auth
   */
  async function initSMART() {
    // Initialize provider first
    const providerKey = getCurrentProviderKey();
    await setProvider(providerKey);

    // Check if we're handling an OAuth callback
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');
    const state = urlParams.get('state');
    const error = urlParams.get('error');

    if (error) {
      console.error('[SMART] OAuth error:', error, urlParams.get('error_description'));
      clearAuthData();
      return { success: false, error: error, errorDescription: urlParams.get('error_description') };
    }

    if (code && state) {
      // Handle OAuth callback
      return await handleCallback(code, state);
    }

    // Check for existing valid token
    const existingToken = localStorage.getItem(STORAGE_TOKEN);
    const expiresAt = localStorage.getItem(STORAGE_EXPIRES);
    const savedPatient = localStorage.getItem(STORAGE_PATIENT);
    const savedPractitioner = localStorage.getItem(STORAGE_PRACTITIONER);

    if (existingToken && expiresAt && Date.now() < parseInt(expiresAt)) {
      accessToken = existingToken;
      patientId = savedPatient;
      practitionerId = savedPractitioner;
      encounterId = localStorage.getItem(STORAGE_ENCOUNTER);
      isInitialized = true;

      // Initialize FHIR client
      initFhirClient();

      return { success: true, fromStorage: true };
    }

    // Check for EHR launch context (if launched from EHR)
    const launch = urlParams.get('launch');
    const iss = urlParams.get('iss');

    if (launch && iss) {
      // EHR launch - need to discover endpoints from iss
      return await initiateEhrLaunch(launch, iss);
    }

    return { success: false, reason: 'no_session' };
  }

  /**
   * Initiate SMART authorization flow
   */
  async function authorize() {
    if (!currentProvider) {
      throw new Error('No provider selected. Call setProvider() first.');
    }

    if (!SMART_CONFIG.clientId) {
      const providerName = currentProvider.name;
      const clientId = prompt(`Enter your ${providerName} Client ID:`);
      if (!clientId) {
        return { success: false, error: 'no_client_id' };
      }
      saveClientId(clientId);
    }

    // Generate state and PKCE verifier
    const state = generateRandomString(32);
    const codeVerifier = generateRandomString(64);
    const codeChallenge = await pkceChallengeFromVerifier(codeVerifier);

    // Store PKCE verifier for callback
    sessionStorage.setItem('smart_code_verifier', codeVerifier);
    sessionStorage.setItem('smart_state', state);

    // Build authorization URL
    const authUrl = new URL(SMART_CONFIG.authorizeUrl);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('client_id', SMART_CONFIG.clientId);
    authUrl.searchParams.set('redirect_uri', SMART_CONFIG.redirectUri);
    authUrl.searchParams.set('scope', SMART_CONFIG.scopes.join(' '));
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('code_challenge', codeChallenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');
    authUrl.searchParams.set('aud', SMART_CONFIG.fhirUrl);

    // Add launch context if available
    const launchContext = localStorage.getItem(STORAGE_LAUNCH_CONTEXT);
    if (launchContext) {
      authUrl.searchParams.set('launch', launchContext);
    }

    // Redirect to authorization server
    window.location.href = authUrl.toString();
  }

  /**
   * Initiate EHR launch flow
   */
  async function initiateEhrLaunch(launch, iss) {
    try {
      // Discover SMART configuration from iss
      const smartConfig = await discoverSmartConfig(iss);

      if (smartConfig) {
        SMART_CONFIG.authorizeUrl = smartConfig.authorization_endpoint;
        SMART_CONFIG.tokenUrl = smartConfig.token_endpoint;
        SMART_CONFIG.fhirUrl = iss;
      }

      // Store launch context
      localStorage.setItem(STORAGE_LAUNCH_CONTEXT, launch);

      // Proceed with authorization
      return await authorize();
    } catch (error) {
      console.error('[SMART] EHR launch failed:', error);
      return { success: false, error: 'ehr_launch_failed' };
    }
  }

  /**
   * Discover SMART configuration from FHIR server
   */
  async function discoverSmartConfig(iss) {
    try {
      const response = await fetch(`${iss}/.well-known/smart-configuration`);
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
    const savedState = sessionStorage.getItem('smart_state');
    if (state !== savedState) {
      console.error('[SMART] State mismatch');
      return { success: false, error: 'state_mismatch' };
    }

    const codeVerifier = sessionStorage.getItem('smart_code_verifier');
    if (!codeVerifier) {
      console.error('[SMART] No code verifier found');
      return { success: false, error: 'no_code_verifier' };
    }

    try {
      // Exchange code for token
      const tokenResponse = await fetch(SMART_CONFIG.tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: code,
          redirect_uri: SMART_CONFIG.redirectUri,
          client_id: SMART_CONFIG.clientId,
          code_verifier: codeVerifier
        })
      });

      if (!tokenResponse.ok) {
        const errorData = await tokenResponse.text();
        throw new Error(`Token exchange failed: ${errorData}`);
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

      // Extract context
      if (tokenData.patient) {
        patientId = tokenData.patient;
        localStorage.setItem(STORAGE_PATIENT, patientId);
        console.log('[SMART] Patient from token response:', patientId);
      }

      if (tokenData.encounter) {
        encounterId = tokenData.encounter;
        localStorage.setItem(STORAGE_ENCOUNTER, encounterId);
      }

      // Extract practitioner from token if available
      if (tokenData.fhirUser) {
        practitionerId = tokenData.fhirUser.split('/').pop();
        localStorage.setItem(STORAGE_PRACTITIONER, practitionerId);
      }

      // Also check id_token for user info (OpenID Connect)
      if (tokenData.id_token) {
        try {
          // Decode JWT payload (base64)
          const payload = JSON.parse(atob(tokenData.id_token.split('.')[1]));
          console.log('[SMART] ID token payload:', payload);

          // Look for patient in id_token
          if (payload.patient && !patientId) {
            patientId = payload.patient;
            localStorage.setItem(STORAGE_PATIENT, patientId);
            console.log('[SMART] Patient from id_token:', patientId);
          }

          // Look for practitioner in id_token
          if (payload.profile && !practitionerId) {
            const ref = payload.profile;
            if (ref.startsWith('Practitioner/')) {
              practitionerId = ref.split('/')[1];
              localStorage.setItem(STORAGE_PRACTITIONER, practitionerId);
              console.log('[SMART] Practitioner from id_token:', practitionerId);
            }
          }
        } catch (e) {
          console.error('[SMART] Failed to decode id_token:', e);
        }
      }

      // Check access token JWT for patient context (some servers include it there)
      if (accessToken && !patientId) {
        try {
          const payload = decodeJwtPayload(accessToken);
          if (payload) {
            console.log('[SMART] Access token payload:', payload);
            if (payload.patient) {
              patientId = payload.patient;
              localStorage.setItem(STORAGE_PATIENT, patientId);
              console.log('[SMART] Patient from access token:', patientId);
            }
            if (payload.launch_patient) {
              patientId = payload.launch_patient;
              localStorage.setItem(STORAGE_PATIENT, patientId);
              console.log('[SMART] Patient from launch_patient claim:', patientId);
            }
          }
        } catch (e) {
          console.error('[SMART] Failed to decode access token:', e);
        }
      }

      // Clean up URL (remove code and state)
      const cleanUrl = window.location.origin + window.location.pathname;
      window.history.replaceState({}, document.title, cleanUrl);

      // Clear session storage
      sessionStorage.removeItem('smart_code_verifier');
      sessionStorage.removeItem('smart_state');

      // Initialize FHIR client
      initFhirClient();
      isInitialized = true;

      return { success: true, patient: patientId, practitioner: practitionerId };
    } catch (error) {
      console.error('[SMART] Token exchange failed:', error);
      return { success: false, error: 'token_exchange_failed' };
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
        // Token expired, try refresh
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
   * Refresh access token
   */
  async function refreshToken() {
    const refreshToken = localStorage.getItem(STORAGE_REFRESH);
    if (!refreshToken) {
      return false;
    }

    try {
      const response = await fetch(SMART_CONFIG.tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: SMART_CONFIG.clientId
        })
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

      // Update FHIR client headers
      initFhirClient();

      return true;
    } catch (error) {
      console.error('[SMART] Token refresh failed:', error);
      clearAuthData();
      return false;
    }
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
      if (payload) {
        console.log('[SMART] Access token payload:', payload);
        // Medplum puts the profile in the 'profile' claim
        if (payload.profile) {
          const ref = payload.profile;
          if (typeof ref === 'string' && ref.startsWith('Practitioner/')) {
            practitionerId = ref.split('/')[1];
            localStorage.setItem(STORAGE_PRACTITIONER, practitionerId);
            console.log('[SMART] Found practitioner from access token:', practitionerId);
            return await fetchResource('Practitioner', practitionerId);
          }
        }
      }
    }

    // Search for practitioner by current user's email/sub
    try {
      const payload = decodeJwtPayload(accessToken);
      if (payload && payload.sub) {
        // Search by identifier
        const searchUrl = `${SMART_CONFIG.fhirUrl}/Practitioner?identifier=${encodeURIComponent(payload.sub)}`;
        const response = await fetch(searchUrl, {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Accept': 'application/fhir+json'
          }
        });

        if (response.ok) {
          const bundle = await response.json();
          if (bundle.entry && bundle.entry.length > 0) {
            const practitioner = bundle.entry[0].resource;
            practitionerId = practitioner.id;
            localStorage.setItem(STORAGE_PRACTITIONER, practitionerId);
            console.log('[SMART] Found practitioner via search:', practitionerId);
            return practitioner;
          }
        }
      }
    } catch (error) {
      console.error('[SMART] Failed to search practitioner:', error);
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

    // Build medication reference
    let medicationReference = {};
    if (prescriptionData.brandName && prescriptionData.genericName) {
      medicationReference = {
        medicationCodeableConcept: {
          text: `${prescriptionData.genericName} (${prescriptionData.brandName})`,
          coding: []
        }
      };
    } else if (prescriptionData.genericName) {
      medicationReference = {
        medicationCodeableConcept: {
          text: prescriptionData.genericName,
          coding: []
        }
      };
    }

    // Add dosage information
    const dosageInstruction = [];
    if (prescriptionData.sig) {
      dosageInstruction.push({
        text: prescriptionData.sig
      });
    }

    // Add form if available
    if (prescriptionData.form) {
      dosageInstruction.push({
        route: {
          text: prescriptionData.form
        }
      });
    }

    // Build dispense request
    const dispenseRequest = {};
    if (prescriptionData.qty) {
      dispenseRequest.quantity = {
        value: parseInt(prescriptionData.qty) || prescriptionData.qty,
        unit: prescriptionData.form || 'units'
      };
    }

    const medicationRequest = {
      resourceType: 'MedicationRequest',
      status: 'active',
      intent: 'order',
      subject: {
        reference: `Patient/${targetPatientId}`
      },
      ...medicationReference,
      dosageInstruction: dosageInstruction.length > 0 ? dosageInstruction : undefined,
      dispenseRequest: Object.keys(dispenseRequest).length > 0 ? dispenseRequest : undefined
    };

    // Add requester if practitioner available
    if (practitionerId) {
      medicationRequest.requester = {
        reference: `Practitioner/${practitionerId}`
      };
    }

    // Add encounter if available
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
  async function submitPrescriptionBundle(prescriptionItems, patientData = null) {
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

    localStorage.removeItem(STORAGE_TOKEN);
    localStorage.removeItem(STORAGE_REFRESH);
    localStorage.removeItem(STORAGE_EXPIRES);
    localStorage.removeItem(STORAGE_PATIENT);
    localStorage.removeItem(STORAGE_ENCOUNTER);
    localStorage.removeItem(STORAGE_PRACTITIONER);
    localStorage.removeItem(STORAGE_LAUNCH_CONTEXT);
  }

  /**
   * Logout - clear all SMART data
   */
  function logout() {
    clearAuthData();
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
      isAuthenticated: isAuthenticated()
    };
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

  // ============ Export Public API ============

  /**
   * Set patient ID manually (when not provided by EHR launch)
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
    // Provider management
    setProvider,
    getAvailableProviders,
    getCurrentProviderKey,
    saveClientId,
    getClientIdKey,
    discoverSmartConfig,
    // Direct access to config (read-only recommended)
    get config() { return SMART_CONFIG; },
    get provider() { return currentProvider; },
    get providers() { return PROVIDERS; }
  };

})();
