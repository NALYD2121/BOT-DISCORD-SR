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

const allowedOrigins = ['https://nalyd2121.github.io', null];

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
        const member = await guild.members.fetch(discordUserId);
        if (!member) return res.status(404).json({ success: false, error: 'Membre introuvable' });
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

// Route pour créer un ticket support
app.post('/api/ticket', async (req, res) => {
    try {
        const { discordUserId, sujet, description } = req.body;
        if (!discordUserId || !sujet || !description) {
            return res.status(400).json({ success: false, error: 'Champs manquants' });
        }
        const categoryId = '1364246550561165413';
        const guild = client.guilds.cache.first();
        if (!guild) return res.status(500).json({ success: false, error: 'Bot non connecté à un serveur' });
        const user = await client.users.fetch(discordUserId);
        if (!user) return res.status(404).json({ success: false, error: 'Utilisateur Discord introuvable' });
        const channelName = `ticket-${user.username.toLowerCase()}-${Date.now().toString().slice(-5)}`;
        const channel = await guild.channels.create({
            name: channelName,
            type: 0, // GUILD_TEXT
            parent: categoryId,
            permissionOverwrites: [
                { id: guild.roles.everyone, deny: ['ViewChannel'] },
                { id: STAFF_ROLE_ID, allow: ['ViewChannel', 'SendMessages'] },
                { id: guild.members.me.id, allow: ['ViewChannel', 'SendMessages'] }
            ]
        });
        const closeRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('close_ticket')
                .setLabel('Fermer le ticket')
                .setStyle(ButtonStyle.Danger)
        );
        await channel.send({
            content: `Ticket ouvert par ${user.tag} (ID: ${user.id})\n**Sujet :** ${sujet}\n**Description :** ${description}`,
            components: [closeRow]
        });
        const tickets = readTickets();
        const ticket = {
            id: channel.id,
            userId: discordUserId,
            sujet,
            description,
            status: 'ouvert',
            createdAt: Date.now()
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

// Événement de connexion du bot
client.once("ready", async () => {
    console.log(`Bot connecté en tant que ${client.user.tag}`);

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
        const channel = member.guild.channels.cache.get(RULES_CHANNEL_ID);
        if (!channel) return console.error("Canal des règles introuvable.");

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
    } catch (error) {
        console.error("Erreur lors de l'envoi du message de bienvenue:", error);
    }
});

// Gestion des interactions avec les boutons et commandes
client.on("interactionCreate", async (interaction) => {
    if (!interaction.isCommand() && !interaction.isButton()) return;

    if (interaction.isCommand()) {
        // Limiter l'accès aux commandes à l'utilisateur 1015310406169923665
        if (interaction.user.id !== '1015310406169923665') {
            await interaction.reply({ content: 'Tu n’as pas la permission d’utiliser cette commande.', ephemeral: true });
            return;
        }
        const { commandName, options } = interaction;

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
                    await interaction.channel.delete('Ticket fermé via bouton Discord');
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
                    { id: guild.roles.everyone, deny: ['ViewChannel'] },
                    { id: STAFF_ROLE_ID, allow: ['ViewChannel', 'SendMessages'] },
                    { id: guild.members.me.id, allow: ['ViewChannel', 'SendMessages'] },
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

// Gestion des MP pour système de ticket synchronisé
client.on('messageCreate', async (message) => {
    // Ignorer les messages du bot ou les messages en guild
    if (message.author.bot || message.guild) return;

    // Vérifier si l'utilisateur a déjà un ticket ouvert
    let tickets = readTickets();
    let ticket = tickets.find(t => t.userId === message.author.id && t.status === 'ouvert');
    const guild = client.guilds.cache.first();
    const categoryId = '1364246550561165413';

    // Si pas de ticket ouvert, créer un nouveau channel support
    if (!ticket) {
        const channelName = `ticket-${message.author.username.toLowerCase()}-${Date.now().toString().slice(-5)}`;
        const channel = await guild.channels.create({
            name: channelName,
            type: 0, // GUILD_TEXT
            parent: categoryId,
            permissionOverwrites: [
                { id: guild.roles.everyone, deny: ['ViewChannel'] },
                { id: STAFF_ROLE_ID, allow: ['ViewChannel', 'SendMessages'] },
                { id: guild.members.me.id, allow: ['ViewChannel', 'SendMessages'] }
            ]
        });
        // Message d'accueil dans le channel + bouton pour fermer le ticket
        const closeRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('close_ticket')
                .setLabel('Fermer le ticket')
                .setStyle(ButtonStyle.Danger)
        );
        await channel.send({
            content: `**[Utilisateur]** ${message.author.tag} : ${message.content}`,
            components: [closeRow]
        });
        // Stocker le ticket
        ticket = {
            id: channel.id,
            userId: message.author.id,
            sujet: 'Ticket via MP',
            description: message.content,
            status: 'ouvert',
            createdAt: Date.now()
        };
        tickets.push(ticket);
        writeTickets(tickets);
        // Confirmer à l'utilisateur
        await message.author.send('Ton ticket a bien été créé ! Le support va te répondre ici, en message privé. Tu n’as pas besoin d’aller sur le serveur ou dans un salon, reste simplement sur cette conversation Discord.');
    } else if (ticket.status === 'ferme') {
        // Si le dernier ticket est fermé, créer un nouveau ticket
        const channelName = `ticket-${message.author.username.toLowerCase()}-${Date.now().toString().slice(-5)}`;
        const channel = await guild.channels.create({
            name: channelName,
            type: 0, // GUILD_TEXT
            parent: categoryId,
            permissionOverwrites: [
                { id: guild.roles.everyone, deny: ['ViewChannel'] },
                { id: STAFF_ROLE_ID, allow: ['ViewChannel', 'SendMessages'] },
                { id: guild.members.me.id, allow: ['ViewChannel', 'SendMessages'] }
            ]
        });
        const closeRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('close_ticket')
                .setLabel('Fermer le ticket')
                .setStyle(ButtonStyle.Danger)
        );
        await channel.send({
            content: `**[Utilisateur]** ${message.author.tag} : ${message.content}`,
            components: [closeRow]
        });
        ticket = {
            id: channel.id,
            userId: message.author.id,
            sujet: 'Ticket via MP',
            description: message.content,
            status: 'ouvert',
            createdAt: Date.now()
        };
        tickets.push(ticket);
        writeTickets(tickets);
        await message.author.send('Ton nouveau ticket a bien été créé ! Le support va te répondre ici, en message privé.');
    } else {
        // Si ticket déjà ouvert, relayer le message dans le channel support
        const channel = guild.channels.cache.get(ticket.id);
        if (channel) {
            await channel.send(`**[Utilisateur]** ${message.author.tag} : ${message.content}`);
            // Confirmation à l'utilisateur même si le ticket est déjà ouvert
            await message.author.send('Votre message a bien été transmis au support.');
        }
    }
});

// Relais des messages du staff vers l'utilisateur en MP
client.on('messageCreate', async (message) => {
    // Uniquement dans un channel ticket support
    if (message.guild && message.channel.parentId === '1364246550561165413' && !message.author.bot) {
        let tickets = readTickets();
        const ticket = tickets.find(t => t.id === message.channel.id && t.status === 'ouvert');
        if (ticket) {
            try {
                const user = await client.users.fetch(ticket.userId);
                await user.send(`**[Support]** ${message.author.tag} : ${message.content}`);
            } catch (e) {
                message.channel.send('Impossible d’envoyer le message à l’utilisateur (DM fermés ?).');
            }
        }
    }
});

function cleanText(text) {
    if (!text) return "";
    return text
        .replace(/```diff[\s\S]*?\+ /g, "") // Supprime ```diff et le +
        .replace(/```/g, "") // Supprime les ```
        .replace(/\[(.+?)\]\(.+?\)/g, "$1") // Convertit les liens Markdown
        .replace(/^\s+|\s+$/g, "") // Supprime les espaces au début et à la fin
        .replace(/\n+/g, " ") // Remplace les sauts de ligne par des espaces
        .trim();
}

function extractModInfo(message) {
    try {
        const embed = message.embeds[0];
        if (!embed) return null;

        // Extraction du nom
        let name = "";
        if (embed.title) {
            name = cleanText(embed.title);
        } else if (embed.author && embed.author.name) {
            name = cleanText(embed.author.name);
        } else {
            const nameField = embed.fields.find(
                (f) =>
                    f.name.toLowerCase().includes("nom") ||
                    f.name.toLowerCase().includes("name") ||
                    f.name.includes("▸"),
            );
            if (nameField) {
                name = cleanText(nameField.value);
            }
        }

        // Extraction du type
        let type = "";
        const typeField = embed.fields.find(
            (f) =>
                f.name.toLowerCase().includes("type") ||
                f.name.toLowerCase().includes("catégorie"),
        );
        if (typeField) {
            type = cleanText(typeField.value);
        }

        // Extraction de la description
        let description = "";
        if (embed.description) {
            description = cleanText(embed.description);
        } else {
            const descField = embed.fields.find(
                (f) =>
                    f.name.toLowerCase().includes("description") ||
                    f.name.includes("┌─ Description ─┐"),
            );
            if (descField) {
                description = cleanText(descField.value);
            }
        }

        // Extraction du lien de téléchargement
        let downloadLink = "";

        // Vérifier d'abord dans les composants (boutons)
        if (message.components && message.components.length > 0) {
            for (const row of message.components) {
                for (const component of row.components) {
                    if (
                        component.type === 2 && // Type 2 = bouton
                        component.style === 5 && // Style 5 = lien
                        component.url &&
                        (component.url.includes("mediafire.com") ||
                            component.label
                                .toLowerCase()
                                .includes("télécharger"))
                    ) {
                        downloadLink = component.url;
                        break;
                    }
                }
                if (downloadLink) break;
            }
        }

        // Si pas trouvé dans les boutons, chercher dans les champs
        if (!downloadLink) {
            // Chercher dans tous les champs pour un lien MediaFire
            for (const field of embed.fields) {
                const value = field.value;
                const mediaFireMatch = value.match(
                    /https?:\/\/(?:www\.)?mediafire\.com\/[^\s]+/,
                );
                if (mediaFireMatch) {
                    downloadLink = mediaFireMatch[0];
                    break;
                }
            }
        }

        // Si toujours pas trouvé, chercher dans la description
        if (!downloadLink && embed.description) {
            const mediaFireMatch = embed.description.match(
                /https?:\/\/(?:www\.)?mediafire\.com\/[^\s]+/,
            );
            if (mediaFireMatch) {
                downloadLink = mediaFireMatch[0];
            }
        }

        // Extraction de l'image
        let image = "";
        if (embed.image && embed.image.url) {
            image = embed.image.url;
        } else if (embed.thumbnail && embed.thumbnail.url) {
            image = embed.thumbnail.url;
        }

        // Si le type n'est pas trouvé, utiliser la catégorie actuelle
        if (!type) {
            const categoryKeys = {
                ARME: ["arme", "weapon"],
                VEHICULE: ["véhicule", "vehicle"],
                PERSONNAGE: ["personnage", "character", "ped"],
            };

            for (const [cat, keywords] of Object.entries(categoryKeys)) {
                if (keywords.some((k) => name.toLowerCase().includes(k))) {
                    type = cat;
                    break;
                }
            }
        }

        return {
            name: name || "Sans nom",
            type: type || "Non catégorisé",
            description: description || "Aucune description disponible",
            downloadLink: downloadLink || "#",
            image: image || "",
            date: message.createdTimestamp,
            channelId: message.channelId,
        };
    } catch (error) {
        console.error(
            "Erreur lors de l'extraction des informations du mod:",
            error,
        );
        return null;
    }
}

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

// Connexion du bot Discords
client.login(process.env.DISCORD_TOKEN).catch((error) => {
    console.error("Erreur de connexion au bot Discord:", error);
});
