// monitor.js
const { chromium } = require('playwright');
const { Redis } = require('@upstash/redis');

const redis = new Redis({
  url: process.env.UPSTASH_URL,
  token: process.env.UPSTASH_TOKEN,
});

const CLE_VERROU = 'alerte_billets_doomsday';
const URL_PAGE = 'https://www.pathe.ma/fr/films-evenements/avengers-doomsday-55389';
const SENTINELLE_REGEX = /pas encore diffus[ée]|pas de s[ée]ance programm[ée]e/i;

async function verifierEtatPage() {
  const navigateur = await chromium.launch({ headless: true });
  const page = await navigateur.newPage();
  try {
    await page.goto(URL_PAGE, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(5000); // Laisser Angular hydrater
    const textePage = await page.locator('body').innerText();
    return { sentinellePresente: SENTINELLE_REGEX.test(textePage), textePage };
  } finally {
    await navigateur.close();
  }
}

(async () => {
  console.log('[DÉBUT] Vérification...');

  // 1. Vérifier le verrou en premier
  const verrouExistant = await redis.get(CLE_VERROU);
  if (verrouExistant) {
    console.log('[VERROU] Alerte déjà envoyée. Arrêt.');
    return;
  }

  // 2. Évaluer la condition
  const { sentinellePresente, textePage } = await verifierEtatPage();
  console.log(`[ÉTAT] Sentinelle présente : ${sentinellePresente}`);

  if (sentinellePresente) {
    console.log('[ATTENTE] Rien à signaler.');
    return;
  }

  // 3. Poser le verrou de manière atomique (SET NX)[reference:2]
  const preuve = { date: new Date().toISOString(), url: URL_PAGE, extrait: textePage.substring(0, 500) };
  const verrouPose = await redis.set(CLE_VERROU, JSON.stringify(preuve), { nx: true });

  if (!verrouPose) {
    console.log('[COURSE] Un autre processus a posé le verrou. Pas d\'alerte.');
    return;
  }

  console.log('[ALERTE] Verrou posé. Envoi de l\'appel...');

  // 4. Déclencher l'appel via CallMeBot
  const message = `Alerte billets Doomsday. La page a change. Verifiez manuellement.`;
  const urlCallMeBot = `http://api.callmebot.com/start.php?user=${process.env.TELEGRAM_USER}&text=${encodeURIComponent(message)}&lang=fr-FR-Standard-B`;

  try {
    const reponse = await fetch(urlCallMeBot);
    console.log(`[CALLMEBOT] Statut : ${reponse.status}`);
  } catch (erreur) {
    console.error('[CALLMEBOT] Échec.', erreur);
  }
})();
