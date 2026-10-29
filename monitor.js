import { launch } from 'cloakbrowser';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_URL,
  token: process.env.UPSTASH_TOKEN,
});

const CLE_VERROU = 'alerte_billets_doomsday';
const URL_PAGE = 'https://www.pathe.ma/fr/films-evenements/avengers-doomsday-55389';
const SENTINELLE_REGEX = /pas encore diffus[ée]|pas de s[ée]ance programm[ée]e/i;
const BLOCAGE_REGEX = /Allo Houston|Erreur d'accès/i;

async function verifierEtatPage() {
  const browser = await launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.goto(URL_PAGE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(5000);

    try {
      await page.click('text=Continuer sans accepter', { timeout: 5000 });
      await page.waitForTimeout(1500);
    } catch {}

    const textePage = await page.locator('body').innerText();
    return {
      estBloque: BLOCAGE_REGEX.test(textePage),
      sentinellePresente: SENTINELLE_REGEX.test(textePage),
      textePage,
    };
  } finally {
    await browser.close();
  }
}

(async () => {
  console.log('[DÉBUT] Vérification...');

  const verrouExistant = await redis.get(CLE_VERROU);
  if (verrouExistant) {
    console.log('[VERROU] Alerte déjà envoyée. Arrêt.');
    console.log('Détails:', verrouExistant);
    return;
  }

  const { estBloque, sentinellePresente, textePage } = await verifierEtatPage();

  if (estBloque) {
    console.warn('[BLOQUÉ] Page anti-bot. Aucune action, verrou non posé.');
    return;
  }

  console.log(`[ÉTAT] Sentinelle présente : ${sentinellePresente}`);
  if (sentinellePresente) {
    console.log('[ATTENTE] Rien à signaler.');
    return;
  }

  const preuve = {
    date: new Date().toISOString(),
    url: URL_PAGE,
    extrait: textePage.substring(0, 500),
  };
  const verrouPose = await redis.set(CLE_VERROU, JSON.stringify(preuve), { nx: true });

  if (!verrouPose) {
    console.log('[COURSE] Verrou déjà posé par un autre run.');
    return;
  }

  console.log('[ALERTE] Verrou posé. Envoi de l\'appel...');

  const message = `Alerte billets Doomsday. La page a change. Verifiez manuellement.`;
  const urlCallMeBot = `http://api.callmebot.com/start.php?user=${process.env.TELEGRAM_USER}&text=${encodeURIComponent(message)}&lang=fr-FR-Standard-B`;

  try {
    const reponse = await fetch(urlCallMeBot);
    console.log(`[CALLMEBOT] Statut : ${reponse.status}`);
  } catch (erreur) {
    console.error('[CALLMEBOT] Échec.', erreur);
  }
})();
