// Mit KI erstellt (KI-Log Nr. 7), vom Team geprüft.
const { escapeHtml, formatEuro } = require('./escape');

function buildOrderConfirmationMail({ orderId, email, totalAmount, items, tickets }, qrImages) {
  const itemRows = items.map((item) => `
    <tr style="border-bottom: 1px solid #eee;">
      <td style="padding: 10px 8px; text-align: left;"><strong>${escapeHtml(item.title)}</strong></td>
      <td style="padding: 10px 8px; text-align: center;">${Number(item.quantity)}x</td>
      <td style="padding: 10px 8px; text-align: right;">${formatEuro(item.unitPrice)}</td>
      <td style="padding: 10px 8px; text-align: right; font-weight: bold;">${formatEuro(item.unitPrice * item.quantity)}</td>
    </tr>`).join('');

  const ticketBlocks = tickets.map((ticket, i) => `
    <div style="display: inline-block; width: 180px; margin: 8px; padding: 12px; border: 1px dashed #D1D5DB; border-radius: 8px; text-align: center; vertical-align: top;">
      <img src="cid:ticket-${i}" alt="QR-Code ${escapeHtml(ticket.code)}" style="width: 150px; height: 150px;" />
      <div style="font-size: 12px; font-weight: 600; margin-top: 6px;">${escapeHtml(ticket.title)}</div>
      <div style="font-size: 11px; color: #6B7280; font-family: monospace;">${escapeHtml(ticket.code)}</div>
    </div>`).join('');

  return {
    to: email,
    subject: `Bestätigung für deine Bestellung #${Number(orderId)}`,
    html: `
      <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background-color: #F8F9FA; padding: 30px 10px;">
        <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; border: 1px solid #E5E7EB;">
          <div style="background-color: #3B3FA8; padding: 24px 30px;">
            <h1 style="color: #ffffff; margin: 0; font-size: 24px;">Tixify</h1>
          </div>
          <div style="padding: 30px;">
            <h2 style="color: #1F1B3A; margin-top: 0;">Vielen Dank für deine Bestellung!</h2>
            <p style="color: #4B5563;">Deine Buchung war erfolgreich. Hier die Details zu Bestellung <strong>#${Number(orderId)}</strong>.</p>
            <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px; font-size: 14px;">
              <thead>
                <tr style="border-bottom: 2px solid #E5E7EB; color: #6B7280; font-size: 12px; text-transform: uppercase;">
                  <th style="padding: 8px; text-align: left;">Event</th>
                  <th style="padding: 8px; text-align: center;">Anzahl</th>
                  <th style="padding: 8px; text-align: right;">Einzelpreis</th>
                  <th style="padding: 8px; text-align: right;">Gesamt</th>
                </tr>
              </thead>
              <tbody>${itemRows}</tbody>
              <tfoot>
                <tr>
                  <td colspan="3" style="padding: 16px 8px 0; text-align: right; font-weight: bold;">Gesamtbetrag:</td>
                  <td style="padding: 16px 8px 0; text-align: right; font-weight: bold; color: #3B3FA8;">${formatEuro(totalAmount)}</td>
                </tr>
              </tfoot>
            </table>
            <h3 style="color: #1F1B3A;">Deine Tickets</h3>
            <p style="color: #6B7280; font-size: 13px;">Zeige pro Person den jeweiligen QR-Code am Einlass vor.</p>
            <div style="text-align: center;">${ticketBlocks}</div>
            <p style="color: #6B7280; font-size: 13px; text-align: center; margin-top: 24px;">Alle Tickets findest du auch unter „Meine Buchungen“.</p>
          </div>
        </div>
      </div>
    `,
    attachments: qrImages.map((content, i) => ({
      filename: `ticket-${tickets[i].code}.png`,
      content,
      cid: `ticket-${i}`
    }))
  };
}

module.exports = { buildOrderConfirmationMail };
