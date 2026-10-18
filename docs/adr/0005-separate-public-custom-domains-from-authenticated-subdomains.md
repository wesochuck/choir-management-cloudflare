# Separate Public Custom Domains from Authenticated Subdomains

Every Organization will receive a canonical product subdomain that serves the complete application.
An Organization may additionally connect a customer-owned apex, `www`, or other custom hostname for
its public website, ticketing, donations, auditions, RSVPs, and personalized public links;
authenticated administration and member sessions remain on the canonical product subdomain.

**Why:** Branded apex websites are important to Organizations, but allowing authenticated sessions
on arbitrary customer domains would require cross-domain session exchange, broader trusted-origin
handling, and a materially larger security test matrix. This design supports Cloudflare for SaaS
custom hostnames and DNS-provider apex aliases where available, trading authenticated custom-domain
continuity for a simpler, more auditable identity boundary and a documented `www` fallback when apex
DNS cannot target the SaaS hostname.

Custom-domain `/login` and `/login/` requests hand off to the same Organization's active canonical
product hostname using an HTTP 302 redirect. Both hostnames come from the authoritative registry;
unknown, pending, or disabled custom domains cannot select a destination. The handoff forwards no
query parameters, sets no session cookies, and is not cached. Static asset routing runs these login
paths through the Worker before serving the application shell. Public pages remain on the custom
domain, and authentication APIs remain restricted to canonical product hosts.
