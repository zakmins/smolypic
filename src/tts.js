// French speech for the card-swipe popup. Deliberately not routed through
// i18n's t()/FR (src/translations.js) — that system picks a string based on
// the *interface* language (en/fr), but the spoken announcement is always
// French regardless of which UI language staff have selected.
import { daysRemaining, isUnlimitedSub, isMeteredSub } from './utils.js';

// "20 août 2026" reads naturally out loud; the raw YYYY-MM-DD subEnd doesn't.
function speakDate(dateStr) {
  const d = new Date(`${String(dateStr).slice(0, 10)}T00:00:00`);
  return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }).format(d);
}

// Returns the French sentence to speak for a /swipe event, or null when
// nothing should be said (exits stay silent).
export function buildSpeech(event) {
  if (event.kind === 'unknown') return 'Attention, badge non reconnu.';
  if (event.kind !== 'in') return null;

  const m = event.member;
  const name = m.name;

  if (isMeteredSub(m) && m.sessionsLeft < 0) {
    return `Bienvenue ${name}, votre solde de séances est négatif. Merci de passer à l'accueil.`;
  }
  if (daysRemaining(m) <= 0) {
    return `Bonjour ${name}, votre abonnement a expiré le ${speakDate(m.subEnd)}. Merci de vous rapprocher de l'accueil.`;
  }
  if (isMeteredSub(m) && m.sessionsLeft <= 0) {
    return `Bonjour ${name}, vous avez épuisé toutes vos séances. Merci de vous rapprocher de l'accueil.`;
  }
  if (isUnlimitedSub(m)) {
    return `Bienvenue ${name}, votre abonnement est valide jusqu'au ${speakDate(m.subEnd)}.`;
  }
  const n = m.sessionsLeft;
  return `Bienvenue ${name}, il vous reste ${n} séance${n > 1 ? 's' : ''}, valable jusqu'au ${speakDate(m.subEnd)}.`;
}
