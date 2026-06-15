require('dotenv').config();
const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { Resend } = require('resend');
const cors = require('cors');
const path = require('path');

const app = express();
const resend = new Resend(process.env.RESEND_API_KEY);

// Webhook Stripe doit recevoir le body RAW — avant express.json()
app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature invalide:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'payment_intent.succeeded') {
    const intent = event.data.object;
    const meta = intent.metadata;

    console.log('✅ Paiement reçu:', intent.id, '—', (intent.amount / 100).toFixed(2) + '€');

    // 1. Mail de confirmation au CLIENT
    try {
      await resend.emails.send({
        from: 'VueLéa <commandes@vuelea.fr>',
        to: meta.email,
        subject: '✅ Ta commande VueLéa est confirmée !',
        html: `
          <!DOCTYPE html>
          <html>
          <body style="margin:0;padding:0;background:#f4f1ee;font-family:'Inter',Arial,sans-serif">
            <div style="max-width:560px;margin:40px auto;background:#0a0a0a;border-radius:4px;overflow:hidden">
              <div style="background:linear-gradient(135deg,#111318,#1a1d24);padding:40px 40px 32px;text-align:center;border-bottom:1px solid rgba(201,168,76,.2)">
                <h1 style="color:#f4f1ee;font-size:1.8rem;margin:0;letter-spacing:.02em">Vue<span style="color:#c9a84c;font-style:italic">léa</span></h1>
                <p style="color:#c9a84c;font-size:.7rem;letter-spacing:.2em;text-transform:uppercase;margin:8px 0 0">Commande confirmée</p>
              </div>
              <div style="padding:40px">
                <p style="color:#f4f1ee;font-size:1rem;margin:0 0 8px">Bonjour <strong>${meta.prenom}</strong> 👋</p>
                <p style="color:rgba(244,241,238,.6);font-size:.9rem;line-height:1.7;margin:0 0 32px">
                  Ta commande a bien été reçue et est en cours de traitement. Tu recevras un email avec ton numéro de suivi dès l'expédition.
                </p>

                <div style="background:#16191f;border-radius:4px;padding:24px;margin-bottom:28px">
                  <p style="color:#c9a84c;font-size:.68rem;letter-spacing:.18em;text-transform:uppercase;margin:0 0 16px">Récapitulatif commande</p>
                  <table style="width:100%;border-collapse:collapse">
                    <tr>
                      <td style="color:rgba(244,241,238,.6);font-size:.85rem;padding:8px 0;border-bottom:1px solid rgba(255,255,255,.06)">Produit</td>
                      <td style="color:#f4f1ee;font-size:.85rem;padding:8px 0;border-bottom:1px solid rgba(255,255,255,.06);text-align:right">VueLéa Obsidian AI Edition</td>
                    </tr>
                    <tr>
                      <td style="color:rgba(244,241,238,.6);font-size:.85rem;padding:8px 0;border-bottom:1px solid rgba(255,255,255,.06)">Quantité</td>
                      <td style="color:#f4f1ee;font-size:.85rem;padding:8px 0;border-bottom:1px solid rgba(255,255,255,.06);text-align:right">1</td>
                    </tr>
                    <tr>
                      <td style="color:rgba(244,241,238,.6);font-size:.85rem;padding:8px 0;border-bottom:1px solid rgba(255,255,255,.06)">Livraison</td>
                      <td style="color:#3fd68f;font-size:.85rem;padding:8px 0;border-bottom:1px solid rgba(255,255,255,.06);text-align:right">Offerte</td>
                    </tr>
                    <tr>
                      <td style="color:#f4f1ee;font-size:.95rem;font-weight:700;padding:12px 0 0">Total payé</td>
                      <td style="color:#c9a84c;font-size:1.1rem;font-weight:700;padding:12px 0 0;text-align:right">79,00€</td>
                    </tr>
                  </table>
                </div>

                <div style="background:#16191f;border-radius:4px;padding:24px;margin-bottom:28px">
                  <p style="color:#c9a84c;font-size:.68rem;letter-spacing:.18em;text-transform:uppercase;margin:0 0 16px">Adresse de livraison</p>
                  <p style="color:#f4f1ee;font-size:.88rem;line-height:1.7;margin:0">
                    ${meta.prenom} ${meta.nom}<br>
                    ${meta.adresse}<br>
                    ${meta.code_postal} ${meta.ville}<br>
                    ${meta.pays}
                  </p>
                </div>

                <div style="background:rgba(63,214,143,.08);border:1px solid rgba(63,214,143,.2);border-radius:4px;padding:20px;margin-bottom:32px">
                  <p style="color:#3fd68f;font-size:.82rem;margin:0;line-height:1.6">
                    📦 <strong>Délai de livraison estimé :</strong> 7 à 14 jours ouvrés<br>
                    📧 Tu recevras ton numéro de suivi par email dès l'expédition
                  </p>
                </div>

                <p style="color:rgba(244,241,238,.4);font-size:.78rem;line-height:1.7;margin:0;text-align:center">
                  Une question ? Réponds à cet email ou écris-nous à <a href="mailto:support@vuelea.fr" style="color:#c9a84c">support@vuelea.fr</a><br>
                  © 2025 VueLéa — Tous droits réservés
                </p>
              </div>
            </div>
          </body>
          </html>
        `
      });
      console.log('📧 Mail client envoyé à:', meta.email);
    } catch (e) {
      console.error('Erreur mail client:', e);
    }

    // 2. Mail de notification au VENDEUR (toi)
    try {
      await resend.emails.send({
        from: 'VueLéa Shop <commandes@vuelea.fr>',
        to: process.env.ADMIN_EMAIL,
        subject: `🛒 Nouvelle commande — ${meta.prenom} ${meta.nom} — 79€`,
        html: `
          <!DOCTYPE html>
          <html>
          <body style="margin:0;padding:0;background:#f4f1ee;font-family:Arial,sans-serif">
            <div style="max-width:520px;margin:30px auto;background:#fff;border-radius:4px;overflow:hidden;border:1px solid #e0e0e0">
              <div style="background:#0a0a0a;padding:24px 32px">
                <h2 style="color:#c9a84c;margin:0;font-size:1.1rem">🛒 NOUVELLE COMMANDE VUELÉA</h2>
              </div>
              <div style="padding:32px">
                <table style="width:100%;border-collapse:collapse;font-size:.9rem">
                  <tr><td style="padding:8px 0;color:#666;width:140px">Nom</td><td style="padding:8px 0;font-weight:600">${meta.prenom} ${meta.nom}</td></tr>
                  <tr><td style="padding:8px 0;color:#666">Email</td><td style="padding:8px 0"><a href="mailto:${meta.email}">${meta.email}</a></td></tr>
                  <tr><td style="padding:8px 0;color:#666">Téléphone</td><td style="padding:8px 0">${meta.telephone || 'Non renseigné'}</td></tr>
                  <tr style="border-top:1px solid #eee"><td style="padding:12px 0;color:#666">Adresse</td><td style="padding:12px 0">${meta.adresse}</td></tr>
                  <tr><td style="padding:8px 0;color:#666">Code postal</td><td style="padding:8px 0">${meta.code_postal}</td></tr>
                  <tr><td style="padding:8px 0;color:#666">Ville</td><td style="padding:8px 0">${meta.ville}</td></tr>
                  <tr><td style="padding:8px 0;color:#666">Pays</td><td style="padding:8px 0">${meta.pays}</td></tr>
                  <tr style="border-top:1px solid #eee"><td style="padding:12px 0;color:#666">Montant</td><td style="padding:12px 0;font-weight:700;color:#c9a84c;font-size:1.1rem">79,00€</td></tr>
                  <tr><td style="padding:8px 0;color:#666">Stripe ID</td><td style="padding:8px 0;font-size:.75rem;color:#999">${intent.id}</td></tr>
                </table>

                <div style="background:#fff8e7;border:1px solid #f0d080;border-radius:4px;padding:16px;margin-top:24px">
                  <p style="margin:0;font-size:.85rem;color:#8a6020">
                    <strong>⚡ Action requise :</strong> Commander sur AliExpress / DSers pour cette adresse de livraison.
                  </p>
                </div>
              </div>
            </div>
          </body>
          </html>
        `
      });
      console.log('📧 Mail admin envoyé');
    } catch (e) {
      console.error('Erreur mail admin:', e);
    }
  }

  res.json({ received: true });
});

// JSON pour les autres routes
app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// Créer un PaymentIntent Stripe
app.post('/create-payment-intent', async (req, res) => {
  const { prenom, nom, email, telephone, adresse, code_postal, ville, pays } = req.body;

  if (!prenom || !nom || !email || !adresse || !code_postal || !ville) {
    return res.status(400).json({ error: 'Tous les champs sont requis' });
  }

  try {
    const paymentIntent = await stripe.paymentIntents.create({
      amount: 7900, // 79€ en centimes
      currency: 'eur',
      metadata: { prenom, nom, email, telephone: telephone || '', adresse, code_postal, ville, pays: pays || 'France' },
      automatic_payment_methods: { enabled: true }
    });

    res.json({ clientSecret: paymentIntent.client_secret });
  } catch (err) {
    console.error('Erreur PaymentIntent:', err);
    res.status(500).json({ error: err.message });
  }
});

// Tracking commande (simple pour l'instant)
app.get('/tracking/:id', (req, res) => {
  res.json({
    id: req.params.id,
    statut: 'En cours de préparation',
    etapes: [
      { label: 'Commande confirmée', done: true, date: new Date().toLocaleDateString('fr-FR') },
      { label: 'En cours de préparation', done: true, date: '' },
      { label: 'Expédiée', done: false, date: '' },
      { label: 'Livrée', done: false, date: '' }
    ]
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 VueLéa server running on port ${PORT}`));
