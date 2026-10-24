// Mit KI erstellt (KI-Log Nr. 7), vom Team geprüft.
const { escapeHtml } = require('./escape');

function buildWelcomeMail({ email, username }) {
  const name = escapeHtml(username);
  return {
    to: email,
    subject: 'Willkommen bei Tixify! 🎟️',
    html: `
      <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 8px;">
        <h2 style="color: #3B3FA8;">Willkommen bei Tixify, ${name}!</h2>
        <p>Dein Account wurde erfolgreich erstellt.</p>
        <p>Du kannst dich ab sofort einloggen, Events durchstöbern und deine Tickets buchen.</p>
        <p>Viel Spaß wünscht dir dein Tixify-Team!</p>
      </div>
    `,
    text: `Willkommen bei Tixify, ${username}! Dein Account wurde erfolgreich erstellt.`
  };
}

module.exports = { buildWelcomeMail };
