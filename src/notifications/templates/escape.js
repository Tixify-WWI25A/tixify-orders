// Mit KI erstellt (KI-Log Nr. 7), vom Team geprüft.
/**
 * Maskiert HTML-Sonderzeichen. Event-Titel und Benutzernamen kommen aus der Datenbank
 * und werden von Nutzern bzw. Admins eingegeben – ungefiltert in Mail-HTML eingesetzt
 * ließe sich darüber fremdes HTML/Links in unsere Mails einschleusen.
 */
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Formatiert einen Betrag deutsch: 199.9 -> "199,90 €" */
function formatEuro(amount) {
  return `${Number(amount).toFixed(2).replace('.', ',')} €`;
}

module.exports = { escapeHtml, formatEuro };
