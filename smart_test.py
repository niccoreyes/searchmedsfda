#!/usr/bin/env python3
"""
SMART on FHIR OAuth Flow Test Script

This script simulates the SMART on FHIR authorization flow to help diagnose
differences between FHIR servers (e.g., FHIRLab vs Edge Aidbox).

Usage:
    # Compare both servers (full auth flow on each) - DEFAULT
    python smart_test.py

    # Test single server
    python smart_test.py --server https://aidbox.fhirlab.net
    python smart_test.py --server https://mriqptagjm.edge.aidbox.app
"""

import argparse
import base64
import hashlib
import json
import secrets
import sys
import urllib.parse
import urllib.request
import urllib.error
from http.server import HTTPServer, BaseHTTPRequestHandler
import webbrowser
import threading
import time


class CallbackHandler(BaseHTTPRequestHandler):
    """HTTP handler to capture OAuth callback."""

    code = None
    state = None
    error = None
    error_description = None

    def log_message(self, format, *args):
        """Suppress default logging."""
        pass

    def do_GET(self):
        """Handle GET request with OAuth callback."""
        parsed = urllib.parse.urlparse(self.path)
        params = urllib.parse.parse_qs(parsed.query)

        if 'code' in params:
            CallbackHandler.code = params['code'][0]
            CallbackHandler.state = params.get('state', [None])[0]
            self.send_response(200)
            self.send_header('Content-type', 'text/html')
            self.end_headers()
            self.wfile.write(b'''
                <html>
                <body style="font-family: sans-serif; text-align: center; padding-top: 50px;">
                    <h1>Authorization Successful!</h1>
                    <p>You can close this window and return to the terminal.</p>
                </body>
                </html>
            ''')
        elif 'error' in params:
            CallbackHandler.error = params['error'][0]
            CallbackHandler.error_description = params.get('error_description', [None])[0]
            self.send_response(400)
            self.send_header('Content-type', 'text/html')
            self.end_headers()
            self.wfile.write(f'''
                <html>
                <body style="font-family: sans-serif; text-align: center; padding-top: 50px;">
                    <h1>Authorization Failed</h1>
                    <p>Error: {CallbackHandler.error}</p>
                    <p>{CallbackHandler.error_description or ''}</p>
                </body>
                </html>
            '''.encode())
        else:
            self.send_response(404)
            self.end_headers()


def generate_pkce_challenge():
    """Generate PKCE code verifier and challenge."""
    code_verifier = base64.urlsafe_b64encode(
        secrets.token_bytes(32)
    ).decode('utf-8').rstrip('=')

    code_challenge = base64.urlsafe_b64encode(
        hashlib.sha256(code_verifier.encode()).digest()
    ).decode('utf-8').rstrip('=')

    return code_verifier, code_challenge


def curl_cmd(method, url, headers=None, data=None):
    """Generate a curl command equivalent for debugging."""
    cmd = f"curl -X {method} '{url}'"
    if headers:
        for key, value in headers.items():
            cmd += f" \\\n  -H '{key}: {value}'"
    if data:
        cmd += f" \\\n  -d '{data}'"
    return cmd


def discover_smart_config(server_url):
    """Perform SMART discovery from the FHIR server."""
    print(f"\n[DISCOVERY] Attempting SMART discovery from {server_url}")

    # Try both root and /fhir paths
    paths = [
        "/.well-known/smart-configuration",
        "/fhir/.well-known/smart-configuration"
    ]

    for path in paths:
        url = server_url.rstrip('/') + path
        print(f"[DISCOVERY] Trying: {url}")
        print(f"[DISCOVERY] curl: {curl_cmd('GET', url, {'Accept': 'application/json', 'Origin': 'http://localhost:3000/callback'})}")
        try:
            req = urllib.request.Request(
                url,
                headers={
                    'Accept': 'application/json',
                    'Origin': 'http://localhost:3000/callback'
                }
            )
            with urllib.request.urlopen(req, timeout=10) as response:
                data = json.loads(response.read().decode())
                print(f"[DISCOVERY] Success at {path}")
                print(f"[DISCOVERY] Authorization endpoint: {data.get('authorization_endpoint')}")
                print(f"[DISCOVERY] Token endpoint: {data.get('token_endpoint')}")
                print(f"[DISCOVERY] Capabilities: {data.get('capabilities', [])}")
                return data
        except urllib.error.HTTPError as e:
            print(f"[DISCOVERY] HTTP Error {e.code} at {path}: {e.reason}")
        except urllib.error.URLError as e:
            print(f"[DISCOVERY] URL Error at {path}: {e.reason}")
        except Exception as e:
            print(f"[DISCOVERY] Error at {path}: {e}")

    return None


def test_cors_preflight(token_url, origin="http://localhost:3000/callback"):
    """Test CORS preflight for token endpoint."""
    print(f"\n[CORS TEST] Testing CORS preflight for {token_url}")
    print(f"[CORS TEST] curl: {curl_cmd('OPTIONS', token_url, {'Origin': origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'Content-Type'})}")

    try:
        req = urllib.request.Request(
            token_url,
            method='OPTIONS',
            headers={
                'Origin': origin,
                'Access-Control-Request-Method': 'POST',
                'Access-Control-Request-Headers': 'Content-Type'
            }
        )
        with urllib.request.urlopen(req, timeout=10) as response:
            print(f"[CORS TEST] Status: {response.status}")
            print(f"[CORS TEST] Access-Control-Allow-Origin: {response.headers.get('Access-Control-Allow-Origin')}")
            print(f"[CORS TEST] Access-Control-Allow-Methods: {response.headers.get('Access-Control-Allow-Methods')}")
            print(f"[CORS TEST] Access-Control-Allow-Headers: {response.headers.get('Access-Control-Allow-Headers')}")
            return True
    except urllib.error.HTTPError as e:
        print(f"[CORS TEST] HTTP Error {e.code}: {e.reason}")
        print(f"[CORS TEST] Response headers: {dict(e.headers)}")
        return False
    except Exception as e:
        print(f"[CORS TEST] Error: {e}")
        return False


def test_token_endpoint_direct(token_url, client_id, code_verifier, origin="http://localhost:3000/callback"):
    """
    Test token endpoint with a fake code to see error response.
    This helps diagnose if CORS is blocking the request.
    """
    print(f"\n[TOKEN TEST] Testing token endpoint directly: {token_url}")

    data = urllib.parse.urlencode({
        'grant_type': 'authorization_code',
        'code': 'invalid_test_code',
        'redirect_uri': origin + '/',
        'client_id': client_id,
        'code_verifier': code_verifier
    })

    print(f"[TOKEN TEST] curl: {curl_cmd('POST', token_url, {'Content-Type': 'application/x-www-form-urlencoded', 'Origin': origin, 'Accept': 'application/json'}, data)}")

    try:
        req = urllib.request.Request(
            token_url,
            data=data.encode(),
            method='POST',
            headers={
                'Content-Type': 'application/x-www-form-urlencoded',
                'Origin': origin,
                'Accept': 'application/json'
            }
        )
        with urllib.request.urlopen(req, timeout=10) as response:
            print(f"[TOKEN TEST] Unexpected success (status {response.status})")
            return True
    except urllib.error.HTTPError as e:
        print(f"\n[TOKEN TEST] *** FAILED ***")
        print(f"[TOKEN TEST] HTTP Method: POST")
        print(f"[TOKEN TEST] URL: {token_url}")
        print(f"[TOKEN TEST] Status: {e.code} {e.reason}")
        print(f"[TOKEN TEST] Response headers:")
        for header, value in e.headers.items():
            print(f"  {header}: {value}")

        # CORS Analysis
        print(f"\n[TOKEN TEST] --- CORS Analysis ---")
        cors_origin = e.headers.get('Access-Control-Allow-Origin')
        cors_methods = e.headers.get('Access-Control-Allow-Methods')
        cors_headers = e.headers.get('Access-Control-Allow-Headers')

        if cors_origin:
            print(f"[TOKEN TEST] ✓ Access-Control-Allow-Origin: {cors_origin}")
            print(f"[TOKEN TEST]   → Server allows requests from: {cors_origin}")
            print(f"[TOKEN TEST]   → Our Origin header was: {origin}")
            if cors_origin != origin and cors_origin != "*":
                print(f"[TOKEN TEST]   ⚠ ORIGIN MISMATCH!")
                print(f"[TOKEN TEST]     Server only allows: '{cors_origin}'")
                print(f"[TOKEN TEST]     We sent: '{origin}'")
                print(f"[TOKEN TEST]     Issue: SERVER CONFIGURATION (Aidbox Client redirect_uri/launch_uri)")
        else:
            print(f"[TOKEN TEST] ✗ Missing 'Access-Control-Allow-Origin' header")
            print(f"[TOKEN TEST]   → This is a CORS violation")
            print(f"[TOKEN TEST]   → Browser would block this response")
            print(f"[TOKEN TEST]   Issue: SERVER (Aidbox CORS not configured)")

        if cors_methods:
            print(f"[TOKEN TEST] ✓ Access-Control-Allow-Methods: {cors_methods}")
        else:
            print(f"[TOKEN TEST] ✗ Missing 'Access-Control-Allow-Methods' header")

        if cors_headers:
            print(f"[TOKEN TEST] ✓ Access-Control-Allow-Headers: {cors_headers}")
        else:
            print(f"[TOKEN TEST] ✗ Missing 'Access-Control-Allow-Headers' header")

        # Determine where the issue is
        print(f"\n[TOKEN TEST] --- Issue Location ---")
        if e.code == 400:
            print(f"[TOKEN TEST] HTTP 400 = Bad Request (expected for invalid code)")
            print(f"[TOKEN TEST] ✓ Server received and processed the POST request")
            print(f"[TOKEN TEST] ✓ No CORS issue - browser would allow this response")
            print(f"[TOKEN TEST] ✗ Token was invalid (expected in test mode)")
        elif e.code == 401:
            print(f"[TOKEN TEST] HTTP 401 = Unauthorized")
            print(f"[TOKEN TEST] ✗ Client authentication failed")
            print(f"[TOKEN TEST]   Issue: CLIENT (check client_id)")
        elif e.code == 403:
            print(f"[TOKEN TEST] HTTP 403 = Forbidden")
            print(f"[TOKEN TEST] ✗ Server rejected the request")
        elif not cors_origin:
            print(f"[TOKEN TEST] ✗ CORS headers missing")
            print(f"[TOKEN TEST]   Issue: SERVER (Aidbox CORS configuration)")
            print(f"[TOKEN TEST]   Fix: Add '{origin}' to Aidbox CORS allowlist")
        else:
            print(f"[TOKEN TEST] HTTP {e.code} = {e.reason}")

        # Try to read response body
        try:
            body = e.read().decode()
            print(f"\n[TOKEN TEST] Response body: {body[:500]}")
        except:
            pass

        return e.code == 400  # 400 is expected for invalid code


def exchange_code_for_token(token_url, client_id, code, code_verifier, redirect_uri, origin="http://localhost:3000/callback"):
    """Exchange authorization code for access token."""
    print(f"\n[TOKEN EXCHANGE] Exchanging code for token...")
    print(f"[TOKEN EXCHANGE] Token URL: {token_url}")
    print(f"[TOKEN EXCHANGE] Client ID: {client_id}")
    print(f"[TOKEN EXCHANGE] Redirect URI: {redirect_uri}")

    data = urllib.parse.urlencode({
        'grant_type': 'authorization_code',
        'code': code,
        'redirect_uri': redirect_uri,
        'client_id': client_id,
        'code_verifier': code_verifier
    })

    print(f"[TOKEN EXCHANGE] Request body: {data}")
    print(f"[TOKEN EXCHANGE] curl: {curl_cmd('POST', token_url, {'Content-Type': 'application/x-www-form-urlencoded', 'Origin': origin, 'Accept': 'application/json'}, data)}")

    try:
        req = urllib.request.Request(
            token_url,
            data=data.encode(),
            method='POST',
            headers={
                'Content-Type': 'application/x-www-form-urlencoded',
                'Origin': origin,
                'Accept': 'application/json'
            }
        )

        print(f"[TOKEN EXCHANGE] Sending request...")
        with urllib.request.urlopen(req, timeout=30) as response:
            response_data = json.loads(response.read().decode())
            print(f"[TOKEN EXCHANGE] Success! Status: {response.status}")
            print(f"[TOKEN EXCHANGE] Response headers:")
            for header, value in response.headers.items():
                print(f"  {header}: {value}")
            print(f"[TOKEN EXCHANGE] Token response keys: {list(response_data.keys())}")
            return response_data

    except urllib.error.HTTPError as e:
        print(f"\n[TOKEN EXCHANGE] *** FAILED ***")
        print(f"[TOKEN EXCHANGE] HTTP Method: POST")
        print(f"[TOKEN EXCHANGE] URL: {token_url}")
        print(f"[TOKEN EXCHANGE] Status: {e.code} {e.reason}")
        print(f"[TOKEN EXCHANGE] Response headers:")
        for header, value in e.headers.items():
            print(f"  {header}: {value}")

        # CORS Analysis
        print(f"\n[TOKEN EXCHANGE] --- CORS Analysis ---")
        cors_origin = e.headers.get('Access-Control-Allow-Origin')
        cors_methods = e.headers.get('Access-Control-Allow-Methods')
        cors_headers = e.headers.get('Access-Control-Allow-Headers')

        if cors_origin:
            print(f"[TOKEN EXCHANGE] ✓ Access-Control-Allow-Origin: {cors_origin}")
            print(f"[TOKEN EXCHANGE]   → Server allows requests from: {cors_origin}")
            print(f"[TOKEN EXCHANGE]   → Our Origin header was: {origin}")
            if cors_origin != origin and cors_origin != "*":
                print(f"[TOKEN EXCHANGE]   ⚠ ORIGIN MISMATCH! Server only allows '{cors_origin}'")
                print(f"[TOKEN EXCHANGE]     Issue: SERVER CONFIGURATION (Aidbox Client settings)")
        else:
            print(f"[TOKEN EXCHANGE] ✗ Missing 'Access-Control-Allow-Origin' header")
            print(f"[TOKEN EXCHANGE]   → This is a CORS violation")
            print(f"[TOKEN EXCHANGE]   → Browser would block this response")
            print(f"[TOKEN EXCHANGE]   Issue: SERVER CONFIGURATION (CORS not enabled on Aidbox)")

        if cors_methods:
            print(f"[TOKEN EXCHANGE] ✓ Access-Control-Allow-Methods: {cors_methods}")
        else:
            print(f"[TOKEN EXCHANGE] ✗ Missing 'Access-Control-Allow-Methods' header")

        if cors_headers:
            print(f"[TOKEN EXCHANGE] ✓ Access-Control-Allow-Headers: {cors_headers}")
        else:
            print(f"[TOKEN EXCHANGE] ✗ Missing 'Access-Control-Allow-Headers' header")

        # Determine where the issue is
        print(f"\n[TOKEN EXCHANGE] --- Issue Location ---")
        if e.code == 400:
            print(f"[TOKEN EXCHANGE] HTTP 400 = Bad Request (expected for invalid code)")
            print(f"[TOKEN EXCHANGE] ✓ Server received and processed the POST request")
            print(f"[TOKEN EXCHANGE] ✓ No CORS issue - browser would allow this response")
            print(f"[TOKEN EXCHANGE] ✗ Token was invalid (expected in test mode)")
        elif e.code == 401:
            print(f"[TOKEN EXCHANGE] HTTP 401 = Unauthorized")
            print(f"[TOKEN EXCHANGE] ✗ Client authentication failed")
            print(f"[TOKEN EXCHANGE]   Issue: CLIENT (check client_id)")
        elif e.code == 403:
            print(f"[TOKEN EXCHANGE] HTTP 403 = Forbidden")
            print(f"[TOKEN EXCHANGE] ✗ Server rejected the request")
        elif not cors_origin:
            print(f"[TOKEN EXCHANGE] ✗ CORS headers missing")
            print(f"[TOKEN EXCHANGE]   Issue: SERVER (Aidbox CORS configuration)")
            print(f"[TOKEN EXCHANGE]   Fix: Add 'http://localhost:3000/callback' to Aidbox CORS allowlist")
        else:
            print(f"[TOKEN EXCHANGE] HTTP {e.code} = {e.reason}")

        try:
            body = e.read().decode()
            print(f"\n[TOKEN EXCHANGE] Response body: {body}")
        except:
            pass

        raise


def run_authorization_flow(server_url, client_id, port=3000):
    """Run the full SMART authorization flow."""

    redirect_uri = f"http://localhost:{port}/callback"
    origin = "http://localhost:3000/callback/"  # Simulate the deployed app origin

    print("=" * 60)
    print(f"SMART on FHIR Test")
    print(f"Server: {server_url}")
    print(f"Client ID: {client_id}")
    print(f"Redirect URI: {redirect_uri}")
    print("=" * 60)

    # Step 1: Discovery
    smart_config = discover_smart_config(server_url)
    if not smart_config:
        print("\n[ERROR] SMART discovery failed. Cannot proceed.")
        return None

    auth_endpoint = smart_config.get('authorization_endpoint')
    token_endpoint = smart_config.get('token_endpoint')

    if not auth_endpoint or not token_endpoint:
        print("\n[ERROR] Missing authorization or token endpoint in discovery.")
        return None

    # Step 2: Test CORS preflight
    test_cors_preflight(token_endpoint, origin)

    # Step 3: Test token endpoint with invalid code
    test_verifier, _ = generate_pkce_challenge()
    test_token_endpoint_direct(token_endpoint, client_id, test_verifier, origin)

    # Step 4: Generate PKCE
    code_verifier, code_challenge = generate_pkce_challenge()
    state = secrets.token_urlsafe(16)

    print(f"\n[PKCE] Generated code_verifier: {code_verifier[:20]}...")
    print(f"[PKCE] Generated code_challenge: {code_challenge[:20]}...")
    print(f"[PKCE] Generated state: {state}")

    # Step 5: Build authorization URL
    auth_params = {
        'response_type': 'code',
        'client_id': client_id,
        'redirect_uri': redirect_uri,
        'scope': 'openid fhirUser profile launch/patient patient/Patient.read',
        'state': state,
        'code_challenge': code_challenge,
        'code_challenge_method': 'S256',
        'aud': server_url
    }

    auth_url = auth_endpoint + '?' + urllib.parse.urlencode(auth_params)

    print(f"\n[AUTH] Authorization URL: {auth_url}")

    # Step 6: Start callback server
    print(f"\n[SERVER] Starting callback server on port {port}...")
    CallbackHandler.code = None
    CallbackHandler.error = None

    server = HTTPServer(('localhost', port), CallbackHandler)
    server_thread = threading.Thread(target=server.serve_forever)
    server_thread.daemon = True
    server_thread.start()

    # Step 7: Open browser
    print(f"[SERVER] Opening browser for authorization...")
    print(f"[SERVER] Waiting for callback...")
    webbrowser.open(auth_url)

    # Step 8: Wait for callback
    timeout = 120  # seconds
    start_time = time.time()

    while time.time() - start_time < timeout:
        if CallbackHandler.error:
            print(f"\n[ERROR] Authorization failed: {CallbackHandler.error}")
            print(f"[ERROR] Description: {CallbackHandler.error_description}")
            server.shutdown()
            return None

        if CallbackHandler.code:
            print(f"\n[AUTH] Received authorization code!")
            print(f"[AUTH] Code: {CallbackHandler.code[:20]}...")
            print(f"[AUTH] State: {CallbackHandler.state}")
            break

        time.sleep(0.5)
    else:
        print(f"\n[ERROR] Timeout waiting for callback.")
        server.shutdown()
        return None

    server.shutdown()

    # Step 9: Verify state
    if CallbackHandler.state != state:
        print(f"\n[ERROR] State mismatch! Expected {state}, got {CallbackHandler.state}")
        return None

    # Step 10: Exchange code for token
    try:
        token_response = exchange_code_for_token(
            token_endpoint,
            client_id,
            CallbackHandler.code,
            code_verifier,
            redirect_uri,
            origin
        )

        print("\n" + "=" * 60)
        print("SUCCESS! Token obtained:")
        print(f"  Access Token: {token_response.get('access_token', 'N/A')[:50]}...")
        print(f"  Token Type: {token_response.get('token_type', 'N/A')}")
        print(f"  Expires In: {token_response.get('expires_in', 'N/A')}")
        print(f"  Patient: {token_response.get('patient', 'N/A')}")
        print("=" * 60)

        return token_response

    except Exception as e:
        print(f"\n[ERROR] Token exchange failed: {e}")
        return None


def compare_discovery(edge_url, fhirlab_url, client_id):
    """Compare discovery responses between two servers."""
    print("\n" + "=" * 60)
    print("COMPARING SERVER CONFIGURATIONS")
    print("=" * 60)

    print(f"\n--- Edge Aidbox: {edge_url} ---")
    edge_config = discover_smart_config(edge_url)

    print(f"\n--- FHIRLab Aidbox: {fhirlab_url} ---")
    fhirlab_config = discover_smart_config(fhirlab_url)

    if not edge_config or not fhirlab_config:
        print("\n[ERROR] Could not retrieve both configurations.")
        return None, None

    print("\n--- COMPARISON ---")

    keys_to_compare = [
        'authorization_endpoint',
        'token_endpoint',
        'introspection_endpoint',
        'revocation_endpoint',
        'capabilities',
        'code_challenge_methods_supported',
        'grant_types_supported',
        'scopes_supported'
    ]

    for key in keys_to_compare:
        edge_val = edge_config.get(key)
        fhirlab_val = fhirlab_config.get(key)

        if edge_val != fhirlab_val:
            print(f"\n[DIFFERENCE] {key}:")
            print(f"  Edge:    {edge_val}")
            print(f"  FHIRLab: {fhirlab_val}")
        else:
            print(f"\n[SAME] {key}: {edge_val}")

    return edge_config, fhirlab_config


def run_comparison_flow(client_id, port=3000):
    """Run full auth flow on both Edge and FHIRLab servers sequentially."""
    edge_url = 'https://mriqptagjm.edge.aidbox.app'
    fhirlab_url = 'https://aidbox.fhirlab.net'

    # First compare discovery endpoints
    edge_config, fhirlab_config = compare_discovery(edge_url, fhirlab_url, client_id)

    if not edge_config or not fhirlab_config:
        print("\n[ERROR] Discovery failed for one or both servers. Cannot proceed with auth flow.")
        return

    # Run auth flow on Edge
    print("\n" + "=" * 60)
    print("STARTING AUTH FLOW: Edge Aidbox")
    print("=" * 60)
    input("\nPress Enter to start authorization with Edge Aidbox...")
    edge_result = run_authorization_flow(edge_url, client_id, port)

    if edge_result:
        print("\n✓ Edge Aidbox: Authorization flow completed successfully!")
    else:
        print("\n✗ Edge Aidbox: Authorization flow failed.")

    # Run auth flow on FHIRLab
    print("\n" + "=" * 60)
    print("STARTING AUTH FLOW: FHIRLab Aidbox")
    print("=" * 60)
    input("\nPress Enter to start authorization with FHIRLab Aidbox...")
    fhirlab_result = run_authorization_flow(fhirlab_url, client_id, port)

    if fhirlab_result:
        print("\n✓ FHIRLab Aidbox: Authorization flow completed successfully!")
    else:
        print("\n✗ FHIRLab Aidbox: Authorization flow failed.")

    # Final summary
    print("\n" + "=" * 60)
    print("COMPARISON SUMMARY")
    print("=" * 60)
    print(f"Edge Aidbox:    {'✓ SUCCESS' if edge_result else '✗ FAILED'}")
    print(f"FHIRLab Aidbox: {'✓ SUCCESS' if fhirlab_result else '✗ FAILED'}")


def main():
    parser = argparse.ArgumentParser(
        description='Test SMART on FHIR OAuth flow',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Compare both servers (full auth flow) - DEFAULT
  python smart_test.py

  # Test single server
  python smart_test.py --server https://aidbox.fhirlab.net
  python smart_test.py --server https://mriqptagjm.edge.aidbox.app
        """
    )
    parser.add_argument('--server', '-s', help='FHIR server base URL')
    parser.add_argument('--client-id', '-c', default='rx-builder-local', help='Client ID (default: rx-builder-local)')
    parser.add_argument('--port', '-p', type=int, default=3000, help='Local callback port (default: 3000)')
    parser.add_argument('--compare', action='store_true', help='Compare Edge and FHIRLab with full auth flow (default when no args)')
    parser.add_argument('--test-cors', action='store_true', help='Only test CORS, skip full flow')

    args = parser.parse_args()

    # Default to compare mode when no server specified
    if not args.server or args.compare:
        run_comparison_flow(args.client_id, args.port)
        return

    if args.test_cors:
        # Just test discovery and CORS
        smart_config = discover_smart_config(args.server)
        if smart_config:
            token_endpoint = smart_config.get('token_endpoint')
            if token_endpoint:
                test_cors_preflight(token_endpoint)
                test_verifier, _ = generate_pkce_challenge()
                test_token_endpoint_direct(token_endpoint, args.client_id, test_verifier)
        return

    # Run full authorization flow
    result = run_authorization_flow(args.server, args.client_id, args.port)

    if result:
        print("\n✓ Authorization flow completed successfully!")
        sys.exit(0)
    else:
        print("\n✗ Authorization flow failed.")
        sys.exit(1)


if __name__ == '__main__':
    main()
