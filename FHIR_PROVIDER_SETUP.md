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

Aidbox is another excellent sandbox for FHIR development.

### Step-by-Step Setup

1. **Create an Aidbox Account**
   - Go to [https://aidbox.fhirlab.net/](https://aidbox.fhirlab.net/)
   - Click "Sign Up" and create an account
   - Verify your email

2. **Create a Client**
   - Log in to your Aidbox instance
   - Navigate to **Clients** in the left sidebar
   - Click **New Client**
   - Configure:
     - **Name**: Rx Builder
     - **Client Type**: SMART on FHIR App
     - **Redirect URI**: Your app's URL
   - Save the client

3. **Get Your Client ID**
   - Copy the Client ID from the client details page

4. **Configure Rx Builder**
   - Select **Aidbox** from the provider dropdown
   - Click **⚙️ settings**
   - Paste your Client ID
   - Save settings

5. **Connect**
   - Click **Connect EHR** and authorize

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
