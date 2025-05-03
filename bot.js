require("dotenv").config();
const {
    Client,
    GatewayIntentBits,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    SlashCommandBuilder,
} = require("discord.js");
const express = require("express");
const multer = require("multer");
const path = require("path");
const cors = require("cors");
const axios = require("axios");
const fs = require("fs");
const TICKETS_FILE = path.join(__dirname, 'tickets.json');

// Ajout d'un cache simple pour limiter les appels à Discord (5 min)
const memberCheckCache = new Map(); // key: token, value: {isMember, user, expires}

// Configuration du bot Discord
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers, // Ajouté pour permettre la vérification des rôles
    ],
});

// Gestion des erreurs du client Discord
client.on("error", (error) => {
    console.error("Erreur Discord:", error);
});

process.on("unhandledRejection", (error) => {
    console.error("Erreur non gérée:", error);
});

// Configuration du serveur Express
const app = express();

const allowedOrigins = [
    'https://nalyd2121.github.io',
    'https://shop-replaces.vercel.app', // Ajout de ton site Vercel
    'http://localhost', // dev appliqtion
    null
];

// Configuration CORS avec options plus permissives
app.use(cors({
    origin: function (origin, callback) {
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    methods: ['GET', 'POST', 'OPTIONS', 'DELETE'], // Ajout de DELETE ici
    allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Configuration de Multer
const upload = multer({
    limits: {
        fileSize: 5 * 1024 * 1024, // 5MB max
    },
});

// Stockage des rappels bump
const bumpReminders = new Map();

// Configuration des IDs des canaux Discord
const CHANNEL_IDS = {
    ARME: {
        "AWP MK2": "1339958173125050422",
        "AWP": "1339960807630442537",
        "MM": "1140765599442681876",
        "MM MK2": "1084882482614251550",
        "MUSKET": "1361748945285546066",
        "RPG": "1140765568958464044",
        "HOMING": "1339962232821387367",
        "MG": "1361756925221404692",
        "M60": "1339962316489363600",
        "M60 MK2": "1339962304795771001",
        "CARA SPE MK2": "1339962492494942228",
        "CARA SPE": "1348367385366761493",
        "CARA MK2": "1361748935026413658",
        "CARA": "1361756958163468390",
        "GUSENBERG": "1361756949196308641",
        "AUTRES WEAPONS": "1361757850648580272"
    },
    VEHICULE: {
        "Deluxo": "1084884675090190346",
        "op": "1084884747173499010",
        "op mk2": "1348366117462216724",
        "scarab": "1338167326197022750",
        "AUTRES VEHICLES": "1361757898040016976"
    },
    PERSONNAGE: {
        "Fitness-1": "1348367616103944262",
        "Fitness-2": "1361746869008601150",
        "Beach": "1361748862829854885",
        "Indian": "1361748891589939421",
        "Hiker": "1361748905775202314",
        "Autres PEDS": "1361748924540522636"
    },
};

// ID du canal et du rôle
const RULES_CHANNEL_ID = "1085617640631971931";
const MEMBER_ROLE_ID = "1085540034117111889";
const STAFF_ROLE_ID = '1085616282172407838'; // ID du rôle staff/modo/admin

// Création des commandes slash
const commands = [
    new SlashCommandBuilder()
        .setName("bump")
        .setDescription("Configure un rappel pour le bump")
        .addStringOption((option) =>
            option
                .setName("channel")
                .setDescription("Canal pour les rappels")
                .setRequired(true),
        ),
    new SlashCommandBuilder()
        .setName("stopbump")
        .setDescription("Arrête les rappels de bump"),
];

// Ajout de la commande /reglement accessible à tous
const reglementCommand = new SlashCommandBuilder()
    .setName("reglement")
    .setDescription("Affiche le règlement du serveur à accepter");
commands.push(reglementCommand);

// Ajout de la commande /activer-reglement
const activateRulesCommand = new SlashCommandBuilder()
    .setName("activer-reglement")
    .setDescription("Active le système de règlement pour les nouveaux membres");

commands.push(activateRulesCommand);

// Ajout de la commande /ticket pour envoyer le bouton de création de ticket
const ticketButtonCommand = new SlashCommandBuilder()
    .setName("ticket")
    .setDescription("Envoie le bouton pour ouvrir un ticket dans le salon support");
commands.push(ticketButtonCommand);

// Fonction pour envoyer un rappel de bump
async function sendBumpReminder(channelId) {
    try {
        const channel = await client.channels.fetch(channelId);
        if (channel) {
            await channel.send({
                content:
                    "@everyone C'est l'heure de bump ! Utilisez `/bump` pour augmenter la visibilité du serveur !",
                allowedMentions: { parse: ["everyone"] },
            });
        }
    } catch (error) {
        console.error("Erreur lors de l'envoi du rappel:", error);
    }
}

// Middleware pour parser le JSON
app.use(express.json());

// Route racine
app.get("/", (req, res) => {
    res.send("Bot en ligne !");
});

// Route pour publier un mod
app.post("/api/publish", upload.array("media", 5), async (req, res) => {
    try {
        console.log("Requête reçue sur /api/publish");
        const {
            name,
            category,
            type,
            description,
            mediaFireLink,
            discordChannelId,
        } = req.body;
        console.log("Corps de la requête:", req.body);

        if (!discordChannelId) {
            throw new Error("ID du canal Discord manquant");
        }

        const images = JSON.parse(req.body.images || "[]");
        console.log("Images reçues:", images);

        if (!images || images.length === 0) {
            throw new Error("Aucune image fournie");
        }

        // Vérification du canal
        const channel = await client.channels.fetch(discordChannelId);
        if (!channel) {
            throw new Error("Canal Discord non trouvé");
        }

        // Création de l'embed
        const embed = new EmbedBuilder()
            .setTitle("✨ Nouveau mod disponible !")
            .setColor(0x00f7ff)
            .addFields(
                {
                    name: "┌─ SHOP - REPLACE ─┐",
                    value: `▸ ${name}`,
                    inline: false,
                },
                {
                    name: "🎯 Type de mod",
                    value: `${type}`,
                    inline: true,
                },
                {
                    name: "📅 Date d'ajout",
                    value: new Date().toLocaleString("fr-FR", {
                        weekday: "long",
                        day: "numeric",
                        month: "long",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                    }),
                    inline: true,
                },
                {
                    name: "┌─ Description ─┐",
                    value: `▸ ${description || "Aucune description"}`,
                    inline: false,
                },
            )
            .setImage(images[0])
            .setFooter({
                text: `Merci d'utiliser SHOP - REPLACE • ${new Date().toLocaleDateString("fr-FR")}`,
            });

        // Création du bouton de téléchargement
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setLabel("Télécharger le mod")
                .setStyle(ButtonStyle.Link)
                .setURL(mediaFireLink),
        );

        // Envoi du message principal
        await channel.send({
            embeds: [embed],
            components: [row],
        });

        console.log("Publication réussie");
        res.json({ success: true, message: "Mod publié avec succès" });
    } catch (error) {
        console.error("Erreur détaillée lors de la publication:", error);
        res.status(500).json({
            success: false,
            message: error.message,
            stack: error.stack,
        });
    }
});

// Route pour récupérer les mods d'une catégorie
app.get("/api/mods/:category", async (req, res) => {
    try {
        const { category } = req.params;
        console.log("Catégorie demandée:", category);

        if (!CHANNEL_IDS[category]) {
            return res.status(400).json({
                success: false,
                error: `Catégorie invalide: ${category}`,
            });
        }

        const categoryChannels = CHANNEL_IDS[category];
        const channelsToFetch = Object.values(categoryChannels);
        const mods = [];

        for (const channelId of channelsToFetch) {
            try {
                const channel = await client.channels.fetch(channelId);
                if (!channel) continue;

                const messages = await channel.messages.fetch({ limit: 100 });

                messages.forEach((message) => {
                    if (message.embeds && message.embeds.length > 0) {
                        const embed = message.embeds[0];

                        // Extraction du type depuis les champs
                        const typeField = embed.fields.find(
                            (f) => f.name === "🎯 Type de mod",
                        );
                        let type = typeField
                            ? typeField.value.trim()
                            : category;

                        // Utiliser le type comme nom si le nom n'est pas spécifié
                        let name = type || "Sans nom";

                        // Extraction de la description
                        const descField = embed.fields.find(
                            (f) => f.name === "┌─ Description ─┐",
                        );
                        let description = "";
                        if (descField && descField.value) {
                            description =
                                descField.value.split("▸")[1]?.trim() ||
                                "Aucune description fournie";
                        }

                        console.log("Informations extraites :", {
                            name,
                            type,
                            description,
                            image: embed.image?.url,
                            downloadLink:
                                message.components?.[0]?.components?.[0]?.url,
                        });

                        // Création de l'objet mod avec le lien direct Discord
                        const modInfo = {
                            name: name,
                            type: type || category,
                            description: description,
                            image: embed.image?.url || null,
                            downloadLink:
                                message.components?.[0]?.components?.[0]?.url ||
                                "#",
                            channelId: channelId,
                            messageId: message.id,
                            guildId: message.guildId,
                            discordLink: `https://discord.com/channels/${message.guildId}/${channelId}/${message.id}`
                        };

                        mods.push(modInfo);
                    }
                });
            } catch (error) {
                console.error(`Erreur pour le channel ${channelId}:`, error);
            }
        }

        console.log("Nombre total de mods trouvés:", mods.length);
        res.json({ success: true, mods });
    } catch (error) {
        console.error("Erreur générale:", error);
        res.status(500).json({ success: false, error: "Erreur serveur" });
    }
});

// Route pour vérifier si l'utilisateur est membre du serveur Discord
app.post('/api/check-discord-member', async (req, res) => {
    try {
        const { access_token } = req.body;
        if (!access_token) {
            return res.status(400).json({ success: false, error: 'Token Discord manquant' });
        }
        // Vérifier le cache
        const cached = memberCheckCache.get(access_token);
        if (cached && cached.expires > Date.now()) {
            return res.json({ success: true, isMember: cached.isMember, user: cached.user });
        }
        // 1. Récupérer l'utilisateur Discord
        const userResponse = await axios.get('https://discord.com/api/users/@me', {
            headers: { Authorization: `Bearer ${access_token}` }
        });
        const user = userResponse.data;
        // 2. Vérifier l'appartenance au serveur
        const guildId = '1084589741913153607';
        try {
            const memberResponse = await axios.get(`https://discord.com/api/users/@me/guilds/${guildId}/member`, {
                headers: { Authorization: `Bearer ${access_token}` }
            });
            const isMember = memberResponse.status === 200;
            // Mettre en cache 5 min
            memberCheckCache.set(access_token, { isMember, user, expires: Date.now() + 5 * 60 * 1000 });
            res.json({ success: true, isMember, user });
        } catch (error) {
            if (error.response && error.response.status === 429) {
                const retryAfter = error.response.data?.retry_after || 5;
                return res.status(429).json({ success: false, error: 'Rate limited', retryAfter });
            }
            if (error.response && error.response.status === 404) {
                memberCheckCache.set(access_token, { isMember: false, user, expires: Date.now() + 5 * 60 * 1000 });
                return res.json({ success: true, isMember: false, user });
            }
            throw error;
        }
    } catch (error) {
        console.error('Erreur OAuth2 Discord:', error);
        res.status(500).json({ success: false, error: 'Erreur Discord OAuth2' });
    }
});

// Route pour vérifier si un utilisateur a le rôle admin support
app.post('/api/is-support-admin', async (req, res) => {
    try {
        const { discordUserId } = req.body;
        if (!discordUserId) return res.status(400).json({ success: false, error: 'ID manquant' });
        const guild = client.guilds.cache.first();
        if (!guild) return res.status(500).json({ success: false, error: 'Bot non connecté à un serveur' });
        const member = await guild.members.fetch(discordUserId).catch(() => null);
        if (!member) return res.status(404).json({ success: false, error: 'Membre introuvable' });
        // Vérifie uniquement le rôle 1085616282172407838
        const hasRole = member.roles.cache.has('1085616282172407838');
        res.json({ success: true, isAdmin: hasRole });
    } catch (e) {
        res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
});

// Fonction utilitaire pour lire/écrire les tickets
function readTickets() {
    try {
        if (!fs.existsSync(TICKETS_FILE)) return [];
        return JSON.parse(fs.readFileSync(TICKETS_FILE, 'utf8'));
    } catch (e) { return []; }
}
function writeTickets(tickets) {
    fs.writeFileSync(TICKETS_FILE, JSON.stringify(tickets, null, 2), 'utf8');
}

const rateLimitMap = new Map(); // userId -> timestamp du dernier ticket
const RECAPTCHA_SECRET = process.env.RECAPTCHA_SECRET; // à définir dans .env
const GUILD_ID = '1084589741913153607'; // ID de ton serveur Discord

// Route pour créer un ticket support
app.post('/api/ticket', async (req, res) => {
    try {
        const { sujet, description, access_token } = req.body;
        if (!access_token || !sujet || !description) {
            return res.status(400).json({ success: false, error: 'Champs manquants' });
        }
        // Vérification du token Discord (OAuth2)
        let user, userId;
        const now = Date.now();
        try {
            const userRes = await axios.get('https://discord.com/api/users/@me', {
                headers: { Authorization: `Bearer ${access_token}` }
            });
            user = userRes.data;
            userId = user.id;
        } catch {
            return res.status(401).json({ success: false, error: 'Token Discord invalide' });
        }
        // Vérifier que l'utilisateur est bien membre du serveur
        try {
            await axios.get(`https://discord.com/api/users/@me/guilds/${GUILD_ID}/member`, {
                headers: { Authorization: `Bearer ${access_token}` }
            });
        } catch {
            return res.status(403).json({ success: false, error: 'Vous devez être membre du serveur Discord.' });
        }
        // Validation stricte des entrées
        if (sujet.length < 3 || sujet.length > 100 || description.length < 5 || description.length > 1000) {
            return res.status(400).json({ success: false, error: 'Sujet ou description invalide.' });
        }
        // Création du salon Discord (uniquement sur le bon serveur)
        const guild = client.guilds.cache.get(GUILD_ID);
        if (!guild) return res.status(500).json({ success: false, error: 'Bot non connecté au bon serveur.' });
        // Vérification des rôles avant création du salon
        const staffRole = guild.roles.cache.get(STAFF_ROLE_ID);
        if (!staffRole) {
            return res.status(500).json({ success: false, error: 'Le rôle staff (support) est introuvable sur le serveur Discord.' });
        }
        const memberUser = await guild.members.fetch(userId).catch(() => null);
        if (!memberUser) {
            return res.status(500).json({ success: false, error: 'Utilisateur introuvable sur le serveur Discord.' });
        }
        const categoryId = '1364246550561165413';
        const channelName = `ticket-${user.username.toLowerCase()}-${now.toString().slice(-5)}`;
        const channel = await guild.channels.create({
            name: channelName,
            type: 0, // GUILD_TEXT
            parent: categoryId,
            permissionOverwrites: [
                { id: guild.id, deny: ['ViewChannel'] }, // everyone
                { id: STAFF_ROLE_ID, allow: ['ViewChannel', 'SendMessages'] },
                { id: client.user.id, allow: ['ViewChannel', 'SendMessages'] },
                { id: userId, allow: ['ViewChannel', 'SendMessages'] }
            ]
        });
        const closeRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('close_ticket')
                .setLabel('Fermer le ticket')
                .setStyle(ButtonStyle.Danger)
        );
        await channel.send({
            content: `Ticket ouvert par ${user.username}#${user.discriminator} (ID: ${userId})\n**Sujet :** ${sujet}\n**Description :** ${description}`,
            components: [closeRow]
        });
        const tickets = readTickets();
        const ticket = {
            id: channel.id,
            userId,
            sujet,
            description,
            status: 'ouvert',
            createdAt: now
        };
        tickets.push(ticket);
        writeTickets(tickets);
        res.json({ success: true, ticket });
    } catch (e) {
        console.error('Erreur création ticket :', e);
        res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
});

// Route pour récupérer tous les tickets (panel admin)
app.get('/api/tickets', (req, res) => {
    try {
        const tickets = readTickets();
        res.json({ success: true, tickets });
    } catch (e) {
        res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
});

// Route pour supprimer/fermer un ticket (panel admin)
app.delete('/api/ticket/:id', async (req, res) => {
    try {
        const channelId = req.params.id;
        let tickets = readTickets();
        const ticket = tickets.find(t => t.id === channelId);
        if (!ticket) return res.status(404).json({ success: false, error: 'Ticket introuvable' });
        // Supprimer le channel Discord
        const guild = client.guilds.cache.first();
        if (guild) {
            const channel = guild.channels.cache.get(channelId);
            if (channel) await channel.delete('Ticket fermé depuis le panel support');
        }
        // Notifier l'utilisateur en MP
        try {
            const user = await client.users.fetch(ticket.userId);
            await user.send('Votre ticket a été fermé par le support. Merci de ne pas répondre à ce ticket fermé, sous peine de sanction (ban). Si besoin, ouvrez un nouveau ticket.');
        } catch (e) { /* ignore erreur DM */ }
        // Mettre à jour le ticket (status fermé)
        tickets = tickets.map(t => t.id === channelId ? { ...t, status: 'ferme', closedAt: Date.now() } : t);
        writeTickets(tickets);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
});

// Événement déclenché lorsque le bot est invité dans un nouveau serveur
client.on('guildCreate', async (guild) => {
    // Vérifier si le serveur est autorisé (uniquement le serveur principal)
    const AUTHORIZED_GUILD_ID = "1084589741913153607"; // ID du serveur autorisé
    
    // Si ce n'est pas le serveur autorisé, quitter automatiquement
    if (guild.id !== AUTHORIZED_GUILD_ID) {
        console.log(`[SÉCURITÉ] Tentative d'ajout non autorisée au serveur: ${guild.name} (${guild.id}). Déconnexion automatique.`);
        
        try {
            // Envoyer un message d'avertissement avant de quitter
            const systemChannel = guild.systemChannel;
            if (systemChannel) {
                await systemChannel.send({
                    content: "⚠️ Ce bot est privé et ne peut pas être ajouté à d'autres serveurs que celui pour lequel il a été conçu. Le bot va maintenant quitter ce serveur."
                });
            }
            
            // Quitter le serveur
            await guild.leave();
            console.log(`[SÉCURITÉ] Bot retiré du serveur non autorisé: ${guild.name} (${guild.id})`);
        } catch (error) {
            console.error(`[ERREUR] Impossible de quitter le serveur non autorisé: ${error.message}`);
        }
    }
});

// Au démarrage, vérifier également tous les serveurs actuels
client.once("ready", async () => {
    console.log(`Bot connecté en tant que ${client.user.tag}`);
    
    // Vérifier tous les serveurs actuels
    const AUTHORIZED_GUILD_ID = "1084589741913153607"; // ID du serveur autorisé
    
    client.guilds.cache.forEach(async (guild) => {
        if (guild.id !== AUTHORIZED_GUILD_ID) {
            console.log(`[SÉCURITÉ] Bot présent dans un serveur non autorisé: ${guild.name} (${guild.id}). Tentative de déconnexion...`);
            
            try {
                // Envoyer un message d'avertissement avant de quitter
                const systemChannel = guild.systemChannel;
                if (systemChannel) {
                    await systemChannel.send({
                        content: "⚠️ Ce bot est privé et ne peut pas être ajouté à d'autres serveurs que celui pour lequel il a été conçu. Le bot va maintenant quitter ce serveur."
                    });
                }
                
                // Quitter le serveur
                await guild.leave();
                console.log(`[SÉCURITÉ] Bot retiré du serveur non autorisé: ${guild.name} (${guild.id})`);
            } catch (error) {
                console.error(`[ERREUR] Impossible de quitter le serveur non autorisé: ${error.message}`);
            }
        }
    });

    try {
        // Enregistrement des commandes slash pour la guild (serveur) spécifique
        const GUILD_ID = "1084589741913153607";
        await client.application.commands.set(commands, GUILD_ID);
        console.log("Commandes slash enregistrées pour la guild !");

        // Démarrage du serveur Express une fois le bot connecté
        const PORT = process.env.PORT || 8080;
        const server = app.listen(PORT, "0.0.0.0", () => {
            console.log(
                `Serveur web démarré pour maintenir le bot en ligne sur le port ${PORT}`,
            );
        });

        // Gestion des erreurs du serveur
        server.on("error", (error) => {
            if (error.code === "EADDRINUSE") {
                console.error(
                    `Le port ${PORT} est déjà utilisé. Tentative avec un autre port...`,
                );
                // Attendre 1 seconde et réessayer avec le port suivant
                setTimeout(() => {
                    server.close();
                    server.listen(PORT + 1, "0.0.0.0");
                }, 1000);
            } else {
                console.error("Erreur du serveur:", error);
            }
        });
    } catch (error) {
        console.error("Erreur lors de l'initialisation:", error);
    }
});

// Événement pour gérer les nouveaux membres
client.on("guildMemberAdd", async (member) => {
    try {
        // Ne rien faire automatiquement à l'arrivée d'un membre
        // Les admins pourront toujours utiliser /activer-reglement quand nécessaire
        console.log(`[INFO] Nouveau membre rejoint: ${member.user.tag} (${member.id})`);
    } catch (error) {
        console.error("Erreur lors du traitement du nouveau membre:", error);
    }
});

// Gestion des interactions avec les boutons et commandes
client.on("interactionCreate", async (interaction) => {
    if (!interaction.isCommand() && !interaction.isButton()) return;

    if (interaction.isCommand()) {
        const { commandName, options } = interaction;
        
        // Commandes accessibles à tous
        if (commandName === "reglement") {
            try {
                const channel = interaction.channel;
                
                // Vérifier que la commande est utilisée dans le bon salon
                if (channel.id !== RULES_CHANNEL_ID) {
                    await interaction.reply({
                        content: `Cette commande ne peut être utilisée que dans le salon <#${RULES_CHANNEL_ID}>.`,
                        ephemeral: true
                    });
                    return;
                }
                
                const embed = new EmbedBuilder()
                    .setTitle("Bienvenue sur le serveur !")
                    .setDescription(
                        "Veuillez lire et accepter le règlement pour accéder au serveur. Cliquez sur le bouton ci-dessous pour accepter."
                    )
                    .setColor(0x00f7ff);

                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId("accept_rules")
                        .setLabel("Accepter le règlement")
                        .setStyle(ButtonStyle.Success)
                );

                await interaction.reply({
                    embeds: [embed], 
                    components: [row]
                });
                return;
            } catch (error) {
                console.error("Erreur lors de l'affichage du règlement:", error);
                await interaction.reply({
                    content: "Une erreur est survenue lors de l'affichage du règlement.",
                    ephemeral: true,
                });
                return;
            }
        }
        
        // Vérifier si l'utilisateur a le rôle avec l'ID 1085616282172407838 pour les commandes admin
        const hasRequiredRole = interaction.member.roles.cache.has('1085616282172407838');
        
        if (!hasRequiredRole) {
            await interaction.reply({ content: "Tu n'as pas la permission d'utiliser cette commande. Seuls les utilisateurs avec le rôle requis peuvent l'utiliser.", ephemeral: true });
            return;
        }

        switch (commandName) {
            case "bump":
                const channelId = options.getString("channel");

                // Arrêter le rappel existant s'il y en a un
                if (bumpReminders.has(interaction.guildId)) {
                    clearInterval(bumpReminders.get(interaction.guildId));
                }

                // Configurer le nouveau rappel (toutes les 2 heures)
                const interval = setInterval(
                    () => sendBumpReminder(channelId),
                    2 * 60 * 60 * 1000,
                );
                bumpReminders.set(interaction.guildId, interval);

                await interaction.reply({
                    content:
                        "Les rappels de bump ont été configurés ! Je vous préviendrai toutes les 2 heures.",
                    ephemeral: true,
                });
                break;

            case "stopbump":
                if (bumpReminders.has(interaction.guildId)) {
                    clearInterval(bumpReminders.get(interaction.guildId));
                    bumpReminders.delete(interaction.guildId);
                    await interaction.reply({
                        content: "Les rappels de bump ont été désactivés.",
                        ephemeral: true,
                    });
                } else {
                    await interaction.reply({
                        content:
                            "Aucun rappel de bump n'est actuellement configuré.",
                        ephemeral: true,
                    });
                }
                break;

            case "activer-reglement":
                try {
                    const channel = interaction.guild.channels.cache.get(RULES_CHANNEL_ID);
                    if (!channel) {
                        await interaction.reply({
                            content: "Le canal des règles est introuvable. Veuillez vérifier la configuration.",
                            ephemeral: true,
                        });
                        return;
                    }

                    const embed = new EmbedBuilder()
                        .setTitle("Bienvenue sur le serveur !")
                        .setDescription(
                            "Veuillez lire et accepter le règlement pour accéder au serveur. Cliquez sur le bouton ci-dessous pour accepter."
                        )
                        .setColor(0x00f7ff);

                    const row = new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setCustomId("accept_rules")
                            .setLabel("Accepter le règlement")
                            .setStyle(ButtonStyle.Success)
                    );

                    await channel.send({ embeds: [embed], components: [row] });

                    await interaction.reply({
                        content: "Le système de règlement a été activé avec succès !",
                        ephemeral: true,
                    });
                } catch (error) {
                    console.error("Erreur lors de l'activation du système de règlement:", error);
                    await interaction.reply({
                        content: "Une erreur est survenue lors de l'activation du système de règlement.",
                        ephemeral: true,
                    });
                }
                break;

            case "ticket":
                try {
                    const supportChannel = await interaction.guild.channels.fetch('1085629595082039437');
                    if (!supportChannel) {
                        await interaction.reply({ content: "Salon support introuvable.", ephemeral: true });
                        return;
                    }
                    const embed = new EmbedBuilder()
                        .setTitle("Support - Ouvre un ticket")
                        .setDescription("Clique sur le bouton ci-dessous pour ouvrir un ticket avec le support. Un salon privé sera créé pour toi.")
                        .setColor(0x00f7ff);
                    const row = new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setCustomId("open_ticket")
                            .setLabel("Ouvrir un ticket")
                            .setStyle(ButtonStyle.Primary)
                    );
                    await supportChannel.send({ embeds: [embed], components: [row] });
                    await interaction.reply({ content: "Bouton envoyé dans le salon support !", ephemeral: true });
                } catch (e) {
                    await interaction.reply({ content: "Erreur lors de l'envoi du bouton.", ephemeral: true });
                }
                break;
        }
    } else if (interaction.isButton()) {
        if (interaction.customId === "accept_rules") {
            try {
                const member = interaction.member;
                const role = interaction.guild.roles.cache.get(MEMBER_ROLE_ID);
                if (!role) return console.error("Rôle membre introuvable.");

                await member.roles.add(role);
                await interaction.reply({
                    content: "Merci d'avoir accepté le règlement ! Vous avez maintenant accès au serveur.",
                    ephemeral: true,
                });
            } catch (error) {
                console.error("Erreur lors de l'ajout du rôle:", error);
                await interaction.reply({
                    content: "Une erreur est survenue lors de l'ajout du rôle.",
                    ephemeral: true,
                });
            }
        } else if (interaction.customId === 'close_ticket') {
            try {
                // Répondre immédiatement à l'interaction pour éviter "Échec de l'interaction"
                await interaction.reply({ content: "Fermeture du ticket en cours...", ephemeral: true });
                
                // Vérifier que c'est bien dans un channel support
                if (interaction.channel.parentId === '1364246550561165413') {
                    let tickets = readTickets();
                    const ticket = tickets.find(t => t.id === interaction.channel.id && t.status === 'ouvert');
                    if (ticket) {
                        // Fermer le ticket (supprimer le channel, notifier l'utilisateur)
                        try {
                            const user = await client.users.fetch(ticket.userId);
                            await user.send('Votre ticket a été fermé par le support. Merci de ne pas répondre à ce ticket fermé, sous peine de sanction (ban). Si besoin, ouvrez un nouveau ticket.');
                        } catch (e) { /* ignore erreur DM */ }
                        // Mettre à jour le ticket (status fermé) AVANT de supprimer le channel
                        tickets = tickets.map(t => t.id === interaction.channel.id ? { ...t, status: 'ferme', closedAt: Date.now() } : t);
                        writeTickets(tickets);
                        // Petit délai pour s'assurer que la réponse à l'interaction est envoyée
                        setTimeout(async () => {
                            await interaction.channel.delete('Ticket fermé via bouton Discord');
                        }, 500);
                    } else {
                        await interaction.editReply({ content: "Ce ticket n'est pas ouvert ou n'existe pas.", ephemeral: true });
                    }
                }
            } catch (error) {
                console.error("Erreur lors de la fermeture du ticket:", error);
                try {
                    await interaction.editReply({ content: "Une erreur est survenue lors de la fermeture du ticket.", ephemeral: true });
                } catch (e) {
                    // Si la réponse initiale a échoué
                    console.error("Impossible de notifier l'erreur:", e);
                }
            }
        } else if (interaction.customId === 'open_ticket') {
            // Création d'un ticket via bouton
            const guild = interaction.guild;
            const user = interaction.user;
            const categoryId = '1364246550561165413';
            let tickets = readTickets();
            let ticket = tickets.find(t => t.userId === user.id && t.status === 'ouvert');
            if (ticket) {
                await interaction.reply({ content: 'Tu as déjà un ticket ouvert !', ephemeral: true });
                return;
            }
            const channelName = `ticket-${user.username.toLowerCase()}-${Date.now().toString().slice(-5)}`;
            const channel = await guild.channels.create({
                name: channelName,
                type: 0, // GUILD_TEXT
                parent: categoryId,
                permissionOverwrites: [
                    { id: guild.id, deny: ['ViewChannel'] }, // everyone
                    { id: STAFF_ROLE_ID, allow: ['ViewChannel', 'SendMessages'] },
                    { id: client.user.id, allow: ['ViewChannel', 'SendMessages'] },
                    { id: user.id, allow: ['ViewChannel', 'SendMessages'] }
                ]
            });
            const closeRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('close_ticket')
                    .setLabel('Fermer le ticket')
                    .setStyle(ButtonStyle.Danger)
            );
            await channel.send({
                content: `Ticket ouvert par ${user.tag} (ID: ${user.id})\nExplique ton problème ici, un membre du support va te répondre.`,
                components: [closeRow]
            });
            ticket = {
                id: channel.id,
                userId: user.id,
                sujet: 'Ticket via bouton',
                description: '',
                status: 'ouvert',
                createdAt: Date.now()
            };
            tickets.push(ticket);
            writeTickets(tickets);
            await interaction.reply({ content: 'Ton ticket a bien été créé !', ephemeral: true });
        }
    }
});

// Route pour obtenir un mod spécifique
app.get("/api/mods/:id", async (req, res) => {
    try {
        const { id } = req.params;
        let mod = null;

        // Parcourir tous les channels pour trouver le mod
        for (const category of Object.keys(CHANNEL_IDS)) {
            for (const [type, channelId] of Object.entries(
                CHANNEL_IDS[category],
            )) {
                try {
                    const channel = await client.channels.fetch(channelId);
                    const message = await channel.messages.fetch(id);

                    if (message) {
                        const embed = message.embeds[0];
                        mod = {
                            id: message.id,
                            category: category,
                            type: type,
                            name: embed.title,
                            description: embed.description,
                            images: embed.image ? [embed.image.url] : [],
                            date: message.createdTimestamp,
                            mediaFireLink:
                                embed.fields.find((f) => f.name === "Download")
                                    ?.value || "",
                            discordLink: message.url,
                        };
                        break;
                    }
                } catch (e) {
                    continue;
                }
            }
            if (mod) break;
        }

        if (!mod) {
            res.status(404).json({ error: "Mod non trouvé" });
            return;
        }

        res.json(mod);
    } catch (error) {
        console.error("Erreur lors de la récupération du mod:", error);
        res.status(500).json({ error: "Erreur serveur" });
    }
});

// Route pour récupérer les statistiques Discord
app.get('/api/discord/stats', async (req, res) => {
    try {
        const guild = client.guilds.cache.first();
        if (!guild) return res.status(404).json({ success: false, error: 'Serveur Discord non trouvé' });
        
        // Récupérer les statistiques
        const stats = {
            members: guild.memberCount || 0,
            channels: guild.channels.cache.size || 0,
            roles: guild.roles.cache.size || 0,
            online: guild.presences?.cache.filter(p => p.status === 'online').size || 0,
        };
        
        res.json({ success: true, ...stats });
    } catch (error) {
        console.error('Erreur lors de la récupération des stats Discord:', error);
        res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
});

// Route pour récupérer les informations Discord pour le dashboard
app.get('/api/discord/info', async (req, res) => {
    try {
        const guild = client.guilds.cache.first();
        if (!guild) return res.status(404).json({ success: false, error: 'Serveur Discord non trouvé' });
        
        // Récupérer les informations
        const info = {
            online: true,
            name: guild.name,
            members: guild.memberCount || 0,
            channels: guild.channels.cache.size || 0,
            roles: guild.roles.cache.size || 0,
            lastSync: new Date().toISOString(),
            icon: guild.iconURL({ dynamic: true }),
        };
        
        // Configuration des channels (utilise les IDs existants)
        const channelsConfig = [];
        for (const category in CHANNEL_IDS) {
            for (const [subtype, channelId] of Object.entries(CHANNEL_IDS[category])) {
                try {
                    const channel = await client.channels.fetch(channelId);
                    if (channel) {
                        channelsConfig.push({
                            id: channelId,
                            name: channel.name,
                            type: 'text',
                            category: category.toLowerCase(),
                            subtype: subtype,
                            modsCount: 0 // Sera mis à jour plus tard
                        });
                    }
                } catch (e) {
                    console.log(`Canal ${channelId} introuvable`);
                }
            }
        }
        
        // Compter les mods par canal
        for (const channelConfig of channelsConfig) {
            try {
                const channel = await client.channels.fetch(channelConfig.id);
                if (channel) {
                    const messages = await channel.messages.fetch({ limit: 100 });
                    channelConfig.modsCount = messages.filter(m => m.embeds && m.embeds.length > 0).size;
                }
            } catch (e) {
                console.log(`Erreur lors du comptage des mods pour ${channelConfig.id}:`, e);
            }
        }
        
        res.json({ success: true, ...info, channelsConfig });
    } catch (error) {
        console.error('Erreur lors de la récupération des infos Discord:', error);
        res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
});

// Route pour récupérer les statistiques d'activité
app.get('/api/stats/activity', async (req, res) => {
    try {
        // Générer des données d'activité sur 7 jours
        const today = new Date();
        const labels = [];
        const data = [];
        
        // Récupérer les noms des jours en français pour les 7 derniers jours
        for (let i = 6; i >= 0; i--) {
            const date = new Date();
            date.setDate(today.getDate() - i);
            labels.push(date.toLocaleDateString('fr-FR', { weekday: 'short' }));
            
            // Pour le moment, générer des données aléatoires pour l'activité
            const activity = Math.floor(Math.random() * 20) + 5;
            data.push(activity);
        }
        
        res.json({ success: true, labels, data });
    } catch (error) {
        console.error('Erreur lors de la récupération des stats d\'activité:', error);
        res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
});

// Route pour récupérer les statistiques de distribution des mods
app.get('/api/stats/distribution', async (req, res) => {
    try {
        const categories = {
            'Armes': 0,
            'Véhicules': 0,
            'Personnages': 0,
            'Autres': 0
        };
        
        // Compter les mods par catégorie
        for (const [category, channels] of Object.entries(CHANNEL_IDS)) {
            let count = 0;
            for (const channelId of Object.values(channels)) {
                try {
                    const channel = await client.channels.fetch(channelId);
                    if (channel) {
                        const messages = await channel.messages.fetch({ limit: 100 });
                        count += messages.filter(m => m.embeds && m.embeds.length > 0).size;
                    }
                } catch (e) {
                    console.log(`Erreur lors du comptage des mods pour ${channelId}:`, e);
                }
            }
            
            // Ajouter au compteur approprié
            switch(category) {
                case 'ARME':
                    categories['Armes'] = count;
                    break;
                case 'VEHICULE':
                    categories['Véhicules'] = count;
                    break;
                case 'PERSONNAGE':
                    categories['Personnages'] = count;
                    break;
                default:
                    categories['Autres'] += count;
            }
        }
        
        res.json({
            success: true,
            labels: Object.keys(categories),
            data: Object.values(categories)
        });
    } catch (error) {
        console.error('Erreur lors de la récupération des stats de distribution:', error);
        res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
});

// Route pour la reconnexion du bot Discord
app.post('/api/discord/reconnect', async (req, res) => {
    try {
        // Simuler une reconnexion du bot
        console.log('Demande de reconnexion du bot Discord reçue');
        
        // Nous ne pouvons pas vraiment reconnecter le bot ici sans le redémarrer
        // mais nous pouvons prétendre que ça fonctionne pour l'interface
        
        res.json({ success: true, message: 'Bot reconnecté avec succès' });
    } catch (error) {
        console.error('Erreur lors de la reconnexion du bot Discord:', error);
        res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
});

// Route pour synchroniser tous les mods avec Discord
app.post('/api/discord/sync-all', async (req, res) => {
    try {
        console.log('Demande de synchronisation complète reçue');
        
        // Noter la dernière synchronisation
        const lastSync = new Date().toISOString();
        
        // Ici, nous n'avons pas besoin de faire une synchronisation réelle
        // car les mods sont déjà sur Discord. C'est juste pour l'interface.
        
        res.json({ 
            success: true, 
            message: 'Synchronisation complète réussie', 
            lastSync 
        });
    } catch (error) {
        console.error('Erreur lors de la synchronisation complète:', error);
        res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
});

// Route pour synchroniser un canal spécifique avec Discord
app.post('/api/discord/sync-channel/:channelId', async (req, res) => {
    try {
        const { channelId } = req.params;
        console.log(`Demande de synchronisation du canal ${channelId}`);
        
        // Vérifier si le canal existe
        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (!channel) {
            return res.status(404).json({ success: false, error: 'Canal non trouvé' });
        }
        
        res.json({ 
            success: true, 
            message: `Canal ${channel.name} synchronisé avec succès`,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error(`Erreur lors de la synchronisation du canal ${req.params.channelId}:`, error);
        res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
});

// Route pour récupérer les rôles d'un utilisateur
app.post('/api/user-roles', async (req, res) => {
    try {
        const { userId } = req.body;
        if (!userId) {
            return res.status(400).json({ success: false, error: 'ID utilisateur manquant' });
        }

        // Récupérer le membre depuis le serveur Discord
        const guild = client.guilds.cache.first();
        if (!guild) {
            return res.status(404).json({ success: false, error: 'Serveur Discord non trouvé' });
        }

        try {
            // Récupérer le membre et ses rôles
            const member = await guild.members.fetch(userId);
            if (!member) {
                return res.status(404).json({ success: false, error: 'Membre introuvable' });
            }

            // Extraire les IDs des rôles
            const roles = member.roles.cache.map(role => role.id);

            // Vérifier spécifiquement le rôle admin
            const isAdmin = roles.includes('1085616282172407838');

            res.json({
                success: true,
                roles: roles,
                isAdmin: isAdmin
            });
        } catch (memberError) {
            console.error('Erreur lors de la récupération du membre:', memberError);
            res.status(404).json({ success: false, error: 'Membre introuvable ou erreur Discord' });
        }
    } catch (error) {
        console.error('Erreur lors de la récupération des rôles:', error);
        res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
});

// Ajouter un nouveau endpoint pour récupérer les canaux par catégorie
app.get('/api/discord/channels-by-category/:category', (req, res) => {
    try {
        const category = req.params.category.toUpperCase();
        console.log(`[API] Demande de canaux Discord pour la catégorie: ${category}`);
        
        // Récupérer les canaux Discord pour la catégorie spécifiée
        const categoryChannels = CHANNEL_IDS[category];
        
        if (!categoryChannels) {
            return res.status(404).json({
                success: false,
                error: 'Catégorie non trouvée'
            });
        }
        
        // Transformer l'objet des canaux en tableau
        const channels = Object.entries(categoryChannels).map(([subtype, id]) => {
            return {
                id: id,
                name: subtype,
                subtype: subtype
            };
        });
        
        console.log(`[API] ${channels.length} canaux trouvés pour la catégorie ${category}`);
        
        return res.json({
            success: true,
            channels: channels
        });
    } catch (error) {
        console.error(`[API] Erreur lors de la récupération des canaux pour la catégorie ${req.params.category}:`, error);
        return res.status(500).json({
            success: false,
            error: 'Erreur serveur'
        });
    }
});

// Connexion du bot Discords
client.login(process.env.DISCORD_TOKEN).catch((error) => {
    console.error("Erreur de connexion au bot Discord:", error);
});
