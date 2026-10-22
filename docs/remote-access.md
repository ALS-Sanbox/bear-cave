# Remote access

Bear Cave binds only to 127.0.0.1. A separate local cloudflared process forwards a public HTTPS hostname to it without router port forwarding. Windows must stay logged in with Bear Cave running; start-with-Windows is a login item, not a service.

Set the administrator password locally and verify `http://127.0.0.1:43110`. In tray Settings set the exact Public HTTPS URL, e.g. `https://bearcave.lionhosting.net`, and enable tunnel trust. Port changes require Quit/restart and a matching tunnel destination. No remote setup/account-claim endpoint exists.

Install/authenticate cloudflared separately using official Windows instructions. You must control the DNS zone. Example locally managed commands:

```powershell
cloudflared.exe tunnel login
cloudflared.exe tunnel create bear-cave
cloudflared.exe tunnel route dns bear-cave bearcave.lionhosting.net
```

Keep configuration/credentials outside the repository, e.g. `%USERPROFILE%\.cloudflared\config.yml`. Replace placeholders:

```yaml
tunnel: YOUR-TUNNEL-UUID
credentials-file: C:/Users/YOUR-USER/.cloudflared/YOUR-TUNNEL-UUID.json
ingress:
  - hostname: bearcave.lionhosting.net
    service: http://127.0.0.1:43110
    originRequest:
      httpHostHeader: bearcave.lionhosting.net
  - service: http_status:404
```

```powershell
cloudflared.exe tunnel --config "$env:USERPROFILE\.cloudflared\config.yml" ingress validate
cloudflared.exe tunnel --config "$env:USERPROFILE\.cloudflared\config.yml" run bear-cave
```

A dashboard-managed tunnel can use the same hostname/origin. Preserve public Host, not localhost, and ensure the origin receives a single X-Forwarded-Proto: https value. Enforce visitor HTTPS in Cloudflare. No tunnel, DNS record, account or Windows service was configured here. [Official Cloudflare configuration reference](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/local-management/configuration-file/).

Test from another device: login, HttpOnly/Secure/SameSite=Strict cookie, no mixed content, search/preview/pause/resume, and HTTP-to-HTTPS redirection. Optional Cloudflare Access adds an outer policy but does not replace this application's login.

Proxy trust requires loopback peer, exact configured public Host, local trust setting and forwarded HTTPS. X-Forwarded-Host/For and CF-Connecting-IP do not establish identity. Login limits apply globally: five failed attempts/fifteen minutes, with at most two concurrent password hashes. Sessions last twelve hours and end on restart/password change. Local processes and the tunnel daemon are trusted; no claim is made to distinguish malicious same-user software pretending to be the tunnel.

Local loopback HTTP uses non-Secure cookies; public HTTPS always uses Secure. All data/downloads remain on Windows. The remote UI has no settings, credentials, folder picker, arbitrary browsing or browser-control route.

Troubleshooting: host rejection means check exact hostname, trust setting and forwarded protocol. Connection failures mean check app/port; no LAN listener exists. For CSRF errors reload/sign in at the exact hostname. Startup failures can indicate port conflicts or app-data permissions. Quit development builds before running packaged Bear Cave.

## Library APIs in 0.3.0

Queue/history are server-paginated and filtered; summary counts and source holds accompany bounded pages. Covers use authenticated source/series URLs on the same origin, never external image URLs carrying credentials. Follow schedules run on the Windows process, not Cloudflare. Hiding a browser tab pauses polling; returning refreshes the session/work state. Verification and redownload accept stored job IDs only, not filesystem paths. Source browser sessions and confirmed staging cleanup remain local IPC only. No tunnel/DNS/account configuration is changed by this release.
