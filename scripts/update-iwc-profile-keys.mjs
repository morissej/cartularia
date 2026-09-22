import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import {
  IWC_PROFILE_KEYS_USAGE,
  parseIwcProfileKeysArgs,
  runIwcProfileKeysCli,
} from './lib/iwc-profile-keys-command.mjs';

/**
 * Complète les clés de profil du brouillon privé IWC (ADR-029) sans Storage ni dossier source :
 * cartularia-creation-profile, cartularia-public-code, cartularia-sensitivity-prices créées si
 * absentes ; originTitle fusionné dans cartularia-editable-copy s'il manque. Rien n'est écrasé.
 *
 *   GCLOUD_PROJECT=<projet> node scripts/run-with-firebase-cli-adc.mjs -- node scripts/update-iwc-profile-keys.mjs --dry-run --allow-remote
 *   GCLOUD_PROJECT=<projet> node scripts/run-with-firebase-cli-adc.mjs -- node scripts/update-iwc-profile-keys.mjs --apply --request-sync --allow-remote
 *   GCLOUD_PROJECT=<projet> node scripts/run-with-firebase-cli-adc.mjs -- node scripts/update-iwc-profile-keys.mjs --dry-run --allow-partial --allow-remote
 *   (la dernière : contrôle après --apply --allow-partial ; hors émulateur, applicationDefault() exige
 *   GOOGLE_APPLICATION_CREDENTIALS, que le wrapper fournit depuis la session Firebase CLI)
 *
 * Le rapport est classé Secret (root.valuation porte les montants de la racine) ; l'avertissement
 * creation_profile_drives_valuation signale que la prochaine synchronisation tirerait purchasePrice,
 * costBasis et grossValuation du profil de création. Demande pending jamais traitée :
 * npm run sync:worker -- --allow-remote, lancé via le même wrapper (voir --help).
 *
 * Toute la logique (analyse des arguments, garde de cible IWC, plan, application, rapport) vit dans
 * scripts/lib/iwc-profile-keys-command.mjs (runIwcProfileKeysCli, testée en mémoire) ; ce fichier
 * ne fait que l'aide, initializeApp et getFirestore.
 */
const argv = process.argv.slice(2);
const parsed = parseIwcProfileKeysArgs(argv, process.env);
if (parsed.help) {
  console.log(IWC_PROFILE_KEYS_USAGE);
  process.exit(0);
}
if (!parsed.ok) {
  console.error(`${parsed.errors.join('\n')}\n${IWC_PROFILE_KEYS_USAGE}`);
  process.exit(1);
}

const { projectId, usesEmulator } = parsed.options;
const app = getApps()[0] || initializeApp({ projectId, ...(usesEmulator ? {} : { credential: applicationDefault() }) });
const firestore = getFirestore(app);

const { exitCode } = await runIwcProfileKeysCli({ argv, env: process.env, firestore, stdout: process.stdout, stderr: process.stderr });
process.exitCode = exitCode;
