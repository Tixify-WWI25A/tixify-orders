// Mit KI erstellt nach unserer Vorgabe (KI-Log Nr. 13): Höchstmenge an einer Stelle statt überall eine feste 5.

/**
 * Höchstens so viele Tickets darf ein Kunde für ein Event besitzen – über alle Bestellungen zusammen.
 * Schutz gegen Aufkäufer und Wiederverkauf. Über MAX_TICKETS_PER_EVENT änderbar, ohne Code anzufassen.
 */
const MAX_TICKETS_PER_EVENT = Number(process.env.MAX_TICKETS_PER_EVENT) || 5;

module.exports = { MAX_TICKETS_PER_EVENT };
