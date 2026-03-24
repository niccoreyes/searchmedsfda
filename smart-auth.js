/**
 * SMART on FHIR Authentication Module for Rx Builder
 * Integrates with Medplum for EHR connectivity
 */

(function () {
  'use strict';

  // Medplum SMART Configuration
  const SMART_CONFIG = {
    // Medplum sandbox server
    baseUrl: 'https://api.medplum.com',
    fhirUrl: 'https://api.medplum.com/fhir/R4',
    authorizeUrl: 'https://api.medplum.com/oauth2/authorize',
    tokenUrl: 'https://api.medplum.com/oauth2/token',
    // Client configuration - auto-detected based on hostname
    // Dev environment: 217f9e4b-4980-470c-9b09-c1bab39154db
    // Prod environment: configure via localStorage 'smart_client_id'
    clientId: '', // Auto-set in initSMART() based on hostname or localStorage
    redirectUri: '', // Auto-detected from current URL
    scopes: [
      'openid',
      'fhirUser',
      'profile',
      'launch/patient',
      'patient/Patient.read',
      'patient/Practitioner.read',
      'patient/MedicationRequest.read',
      'patient/MedicationRequest.write',
      'patient/Medication.read'
    ]
  };

  // Storage keys
  const STORAGE_TOKEN = 'smart_access_token';
  const STORAGE_REFRESH = 'smart_refresh_token';
  const STORAGE_EXPIRES = 'smart_token_expires';
  const STORAGE_PATIENT = 'smart_patient_id';
  const STORAGE_ENCOUNTER = 'smart_encounter_id';
  const STORAGE_PRACTITIONER = 'smart_practitioner_id';
  const STORAGE_CLIENT_ID = 'smart_client_id';
  const STORAGE_LAUNCH_CONTEXT = 'smart_launch_context';

  // State
  let accessToken = null;
  let patientId = null;
  let practitionerId = null;
  let encounterId = null;
  let fhirClient = null;
  let isInitialized = false;

  /**
   * Initialize SMART on FHIR
   * Check for existing session or handle callback from auth
   */
  async function initSMART() {
    // Set redirect URI to current origin
    SMART_CONFIG.redirectUri = window.location.origin + window.location.pathname;

    // Auto-detect client ID based on hostname
    const hostname = window.location.hostname;
    if (hostname === 'devrxbuilder.vercel.app') {
      SMART_CONFIG.clientId = '217f9e4b-4980-470c-9b09-c1bab39154db';
    } else if (hostname === 'rxbuilder.vercel.app') {
      // Production client ID - set via localStorage or prompt
      const savedClientId = localStorage.getItem(STORAGE_CLIENT_ID);
      if (savedClientId) {
        SMART_CONFIG.clientId = savedClientId;
      }
    } else {
      // Local development or other - use localStorage or prompt
      const savedClientId = localStorage.getItem(STORAGE_CLIENT_ID);
      if (savedClientId) {
        SMART_CONFIG.clientId = savedClientId;
      }
    }

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
    if (!SMART_CONFIG.clientId) {
      const clientId = prompt('Enter your Medplum Client ID:');
      if (!clientId) {
        return { success: false, error: 'no_client_id' };
      }
      SMART_CONFIG.clientId = clientId;
      localStorage.setItem(STORAGE_CLIENT_ID, clientId);
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
   * Get current practitioner
   */
  async function getPractitioner() {
    if (!practitionerId) {
      // Try to get from fhirUser claim
      throw new Error('No practitioner context');
    }
    return await fetchResource('Practitioner', practitionerId);
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

  window.SMARTAuth = {
    init: initSMART,
    authorize,
    logout,
    isAuthenticated,
    getContext,
    getPatient,
    getPractitioner,
    loadPractitionerInfo,
    createMedicationRequest,
    submitPrescriptionBundle,
    fetchResource,
    searchResource,
    createResource,
    updateResource,
    config: SMART_CONFIG
  };

})();
