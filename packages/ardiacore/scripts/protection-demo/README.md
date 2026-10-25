# Recording the protection demo

Run against an already running, isolated Ardia test instance with its performance
probe enabled and an `instance.json` record. Keep the browser on its default
profile in a normal window, with a unique page open so the lab can identify its extension context.

```sh
node packages/ardiacore/scripts/protection-demo/server.mjs /tmp/ardia-your-demo
```

The command opens a local dashboard in that browser and prints its URL. It saves
`protection-demo.json` in the instance directory. Keep the process running while
recording. No native app rebuild is needed for changes to the page.

1. Choose Standard in Settings → Privacy, then add a sample or start a stream.
   Samples are hidden, but not collected or clicked.
2. Choose Active obfuscation and confirm in Ardia. The dashboard updates without
   reloading. Cards show actual collection and completed background visits.
   The normal scheduler is unchanged; allow up to a minute for the first visit.
3. Switch back to Standard. New samples are still hidden, while collection and
   clicking stop. Existing vault entries remain visible as historical results.
4. Pause protection in the shield to show visible samples and an allowed tracker
   request. Resume protection to restore hiding and eligible background visits.
5. Use **New take** to clear the display. This does not delete the vault or cancel
   queued visits. **Pause stream** only stops adding new samples.

The cards are monitor illustrations. A separate same-origin frame contains the
actual image ads, hidden by a session-specific cosmetic rule. Every offered ad
has a unique destination. “Clicked” requires a positive AdNauseam visit timestamp
and a request fulfilled locally through DevTools. Counters count each offered
sample once even if navigation causes another vault entry for the same target. There is no timer that invents
success, click acceleration, or consent granted by the page. The test hostname
is reserved for examples; its fixture DNS answer and intercepted response are
only for this recording. No advertising service is contacted.

The page verifies GPC using JavaScript and HTTP headers, and probes an explicit
synthetic tracker rule. CNAME availability, navigation cleaning, security lists
and site cleanup are read from the extension's current settings and labelled as
configuration. The tagged-link action additionally verifies cleaning on an actual
navigation. A local storage marker helps demonstrate last-tab cleanup separately.
Secure DNS, HTTPS upgrades and fingerprinting defenses are not measured here.

The server only listens on loopback, checks Host/Origin, uses an unguessable
session URL and has no endpoint for changing browser protection. Lost connections
stop new samples and clear live protection claims. Stop with Ctrl-C to detach,
restore the fixture DNS resolver and remove only the rules added by this session.
The browser and its existing preferences are left running.
