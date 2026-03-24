# Medplum Configuration

This folder contains configuration files for Medplum FHIR server integration.

## Contents

### `client-application-dev.json`
SMART on FHIR ClientApplication resource for the Rx Builder dev environment.
- Defines OAuth2 client settings for `devrxbuilder.vercel.app`
- Configures redirect URI and launch URI
- Sets up access policies for Patient, Practitioner, and MedicationRequest resources
- Enforces PKCE for secure authentication

### Future Files
This folder may also contain:
- `client-application-prod.json` - Production ClientApplication configuration
- `access-policies/` - Additional AccessPolicy resources for fine-grained permissions
- `bot-logic/` - Medplum Bot configurations for server-side automation
- `subscriptions/` - Subscription resources for real-time notifications

## Usage

To create/update the ClientApplication in Medplum:
```bash
medplum post ClientApplication medplum-config/client-application-dev.json
```

To retrieve the ClientApplication (e.g., to get the client ID):
```bash
medplum get ClientApplication/<id>
```

## Related Configuration

The `smart-auth.js` file in the project root uses the `id` from the ClientApplication
as the `clientId` for OAuth2 authentication flows.
