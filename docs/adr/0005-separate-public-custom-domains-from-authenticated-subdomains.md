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
