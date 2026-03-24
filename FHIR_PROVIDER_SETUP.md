# FHIR Provider Setup Guide

This guide walks you through connecting Rx Builder to different FHIR servers via SMART on FHIR.

## Overview

Rx Builder now supports multiple FHIR providers:

| Provider | URL | Type |
|----------|-----|------|
| **Medplum** | https://api.medplum.com | Sandbox (Default) |
| **Aidbox FHIRLab** | https://aidbox.fhirlab.net | Sandbox |
| **Custom Server** | Your server | Any SMART on FHIR |

---

## Quick Start

1. **Select a Provider** - Use the dropdown in the Prescription tab next to "Connect EHR"
2. **Configure** - Click the settings (⚙️) icon to enter your Client ID
3. **Connect** - Click "Connect EHR" to authenticate

---

## Option 1: Medplum (Recommended for Beginners)

Medplum provides a free sandbox environment perfect for testing.

### Step-by-Step Setup

1. **Create a Medplum Account**
   - Go to [https://app.medplum.com/signin](https://app.medplum.com/signin)
   - Click "Register" to create a new account
   - Verify your email address

2. **Create a Project**
   - After signing in, you'll be prompted to create a project
   - Name it something like "Rx Builder Testing"
   - Click "Create Project"

3. **Create a Client Application**
   - In the left sidebar, click **Project** → **Clients**
   - Click the **New** button
   - Fill in the form:
     - **Name**: Rx Builder (or any name you prefer)
     - **Client Type**: Web Application
     - **Redirect URI**: `https://your-app-url.com/` (or `http://localhost:3000/` for local development)
   - Click **Create**

4. **Get Your Client ID**
   - After creating the client, you'll see a details page
   - Copy the **Client ID** (looks like a UUID: `217f9e4b-...`)

5. **Configure Rx Builder**
   - Open Rx Builder and go to the **Prescription** tab
   - Select **Medplum** from the provider dropdown
   - Click the **⚙️ settings** button
   - Paste your Client ID in the field
   - Click **Save Settings**

6. **Connect**
   - Click **Connect EHR**
   - You'll be redirected to Medplum to sign in
   - Authorize the application
   - You'll be redirected back to Rx Builder, now connected!

---

## Option 2: Aidbox FHIRLab

Aidbox is another excellent sandbox for FHIR development with full SMART on FHIR support.

### Step-by-Step Setup

1. **Create an Aidbox Account**
   - Go to [https://aidbox.fhirlab.net/](https://aidbox.fhirlab.net/)
   - Click "Sign Up" and create an account
   - Verify your email address

2. **Create a Client Resource**
   - Log in to your Aidbox instance
   - Navigate to **REST Console** (in the left sidebar)
   - Copy and paste the following JSON, then click **Execute**:

   > **Note:** Replace `https://devrxbuilder.vercel.app/` with your actual app URL if different

   ```json
   PUT /Client/rx-builder-app
   content-type: application/json

   {
     "resourceType": "Client",
     "id": "rx-builder-app",
     "active": true,
     "type": "smart-app",
     "grant_types": ["authorization_code"],
     "auth": {
       "authorization_code": {
         "redirect_uri": "https://devrxbuilder.vercel.app/",
         "pkce": true,
         "secret_required": false,
         "refresh_token": true,
         "token_format": "jwt",
         "access_token_expiration": 3600
       }
     },
     "smart": {
       "launch_uri": "https://devrxbuilder.vercel.app/"
     }
   }
   ```

3. **Verify Client Creation**
   - After executing, you should see a `201 Created` or `200 OK` response
   - The Client ID is: **`rx-builder-app`** (or whatever you set as the `id`)

4. **Configure Rx Builder**
   - Open Rx Builder and go to the **Prescription** tab
   - Select **Aidbox** from the provider dropdown
   - Click the **⚙️ settings** button
   - Enter your Client ID: `rx-builder-app`
   - Click **Save Settings**

5. **Connect**
   - Click **Connect EHR**
   - You'll be redirected to Aidbox to sign in
   - Authorize the application
   - You'll be redirected back to Rx Builder, now connected!

### Alternative: Using Aidbox UI

If you prefer using the UI instead of REST Console:

1. Go to **Client** → **New**
2. Select resource type: `Client`
3. Fill in these required fields:
   - **id**: `rx-builder-app` (your chosen Client ID)
   - **type**: `smart-app`
   - **grant_types**: `["authorization_code"]`
   - **auth.authorization_code.redirect_uri**: `https://devrxbuilder.vercel.app/`
   - **auth.authorization_code.pkce**: `true`
   - **auth.authorization_code.secret_required**: `false`
   - **smart.launch_uri**: `https://devrxbuilder.vercel.app/`
4. Click **Create**

### Understanding the Client Resource

| Field | Value | Description |
|-------|-------|-------------|
| `id` | `rx-builder-app` | Your Client ID (you choose this) |
| `type` | `smart-app` | Required for SMART on FHIR apps |
| `grant_types` | `["authorization_code"]` | OAuth2 flow type |
| `auth.authorization_code.redirect_uri` | Your app URL | Must match exactly |
| `auth.authorization_code.pkce` | `true` | Required for browser apps |
| `auth.authorization_code.secret_required` | `false` | No secret for public clients |
| `smart.launch_uri` | Your app URL | Required for EHR launch |

Sources: [Aidbox SMART App Launch Docs](https://www.health-samurai.io/docs/aidbox/access-control/authorization/smart-on-fhir/smart-client-authorization/smart-app-launch), [Authorization Code Grant Tutorial](https://www.health-samurai.io/docs/aidbox/tutorials/security-access-control-tutorials/authorization-code-grant)

---

## Option 3: Custom SMART on FHIR Server

For production use or testing with your own FHIR server.

### Requirements

Your FHIR server must support:
- SMART on FHIR launch (standalone or EHR launch)
- OAuth 2.0 with PKCE
- `.well-known/smart-configuration` endpoint (recommended for auto-discovery)

### Step-by-Step Setup

1. **Select Custom Provider**
   - In Rx Builder, select **Custom Server** from the dropdown

2. **Open Settings**
   - Click the **⚙️ settings** button

3. **Configure Server URLs**

   **If your server supports SMART discovery:**
   - Enter your FHIR Base URL (e.g., `https://your-hospital.com/fhir`)
   - Leave Authorization URL and Token URL blank
   - The app will auto-discover them

   **If your server doesn't support discovery:**
   - Enter your FHIR Base URL
   - Enter the Authorization URL
   - Enter the Token URL

4. **Get Client ID from Your Server Admin**
   - Contact your IT/FHIR administrator
   - Request a SMART on FHIR client registration
   - Provide them with your Redirect URI: `https://your-app-url.com/`
   - Request scopes: `openid fhirUser profile launch/patient patient/*.read patient/*.write`

5. **Enter Client ID**
   - Paste the Client ID in the settings modal
   - Save settings

6. **Test Connection**
   - Click **Test Connection** to verify the server is reachable
   - Then click **Connect EHR** to authenticate

---

## Troubleshooting

### "No Client ID configured" error
- You need to enter a Client ID in the settings (⚙️) for your selected provider

### "Invalid client_id" error
- Double-check the Client ID is copied correctly
- Ensure there are no extra spaces
- Verify the Client ID belongs to the selected provider

### "Redirect URI mismatch" error
- The redirect URI in your client configuration must exactly match your app's URL
- Check for trailing slashes, http vs https, etc.

### "Connection failed" when testing
- Check that your FHIR Base URL is correct
- Verify the server is online and accessible
- Check browser console for CORS errors

### Can't find SMART configuration
- Ensure your server has a `.well-known/smart-configuration` endpoint
- Or manually enter the Authorization and Token URLs

---

## Provider-Specific Notes

### Medplum
- Default scopes work out of the box
- Supports both sandbox and production environments
- Pre-configured for `devrxbuilder.vercel.app` in development mode

### Aidbox
- May require additional scope configuration
- Supports FHIR R4 and R5
- Good for testing custom FHIR operations

### Custom Servers
- Epic: Use Epic's App Orchard registration process
- Cerner: Use Cerner's Code Console
- Other: Consult your server's documentation

---

## Security Best Practices

1. **Never share your Client ID** - Keep it private like a password
2. **Use HTTPS** - Always deploy the app over HTTPS in production
3. **Review scopes** - Only request the minimum necessary scopes
4. **Log out** when finished - Click "Disconnect" to clear your session

---

## Need Help?

- Check the browser console for detailed error messages
- Review your provider's documentation:
  - [Medplum Docs](https://www.medplum.com/docs/)
  - [Aidbox Docs](https://docs.aidbox.app/)
  - [SMART on FHIR Spec](https://hl7.org/fhir/smart-app-launch/)
