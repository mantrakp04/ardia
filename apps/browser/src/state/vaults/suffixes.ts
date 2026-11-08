export const REGISTRY_SUFFIXES: ReadonlySet<string> = new Set([
  "co.uk", "org.uk", "me.uk", "ltd.uk", "plc.uk", "net.uk", "ac.uk", "gov.uk", "nhs.uk", "com.au", "net.au", "org.au", "edu.au",
  "gov.au", "co.jp", "ne.jp", "or.jp", "ac.jp", "go.jp", "co.nz", "org.nz", "net.nz", "co.za", "co.in", "net.in", "org.in",
  "co.kr", "or.kr", "com.br", "net.br", "org.br", "com.cn", "net.cn", "org.cn", "com.hk", "com.tw", "com.sg", "com.my", "com.mx",
  "com.ar", "com.tr", "com.ua", "co.il", "co.id", "com.ph", "com.vn", "com.pk", "com.ng", "com.eg", "com.sa", "co.th", "com.pl",
  "com.es", "com.pt", "com.ru", "co.at", "or.at", "co.ke",
]);

export const SHARED_HOSTING_SUFFIXES: readonly string[] = [
  "github.io", "gitlab.io", "herokuapp.com", "vercel.app", "netlify.app", "pages.dev", "workers.dev", "web.app", "firebaseapp.com",
  "blogspot.com", "azurewebsites.net", "cloudfront.net", "appspot.com", "s3.amazonaws.com", "amplifyapp.com", "onrender.com",
  "fly.dev", "glitch.me", "repl.co", "ngrok.io", "ngrok-free.app", "wordpress.com", "myshopify.com", "surge.sh",
];

export const REGISTRY_LABELS: ReadonlySet<string> = new Set(["co", "com", "net", "org", "gov", "edu", "ac", "or", "ne", "go", "gob", "mil", "nom"]);
