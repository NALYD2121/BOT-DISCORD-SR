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

// Configuration CORS avec options plus permissives
app.use(
    cors({
        origin: "*",
        methods: ["GET", "POST", "OPTIONS"],
        allowedHeaders: ["Content-Type", "Authorization"],
        credentials: true,
        optionsSuccessStatus: 200,
    }),
);

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
        AWP: "1339960807630442537",
        MM: "1140765599442681876",
        "MM MK2": "1084882482614251550",
        M60: "1339962316489363600",
        "M60 MK2": "1339962304795771001",
        "CARA SPE MK2": "1339962492494942228",
        "CARA SPE": "1348367385366761493",
        RPG: "1140765568958464044",
        HOMING: "1339962232821387367",
    },
    VEHICULE: {
        DELUXO: "1084884675090190346",
        OP: "1084884747173499010",
        "OP MK2": "1348366117462216724",
        SCARAB: "1338167326197022750",
    },
    PERSONNAGE: {
        FITNESS: "1348367616103944262",
    },
};

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

                        // Création de l'objet mod
                        const modInfo = {
                            name: name,
                            type: type || category,
                            description: description,
                            image: embed.image?.url || null,
                            downloadLink:
                                message.components?.[0]?.components?.[0]?.url ||
                                "#",
                            channelId: channelId,
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

// Événement de connexion du bot
client.once("ready", async () => {
    console.log(`Bot connecté en tant que ${client.user.tag}`);

    try {
        // Enregistrement des commandes slash
        await client.application.commands.set(commands);
        console.log("Commandes slash enregistrées avec succès");

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

// Gestion des commandes slash
client.on("interactionCreate", async (interaction) => {
    if (!interaction.isCommand()) return;

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

// Connexion du bot Discord
client.login(process.env.DISCORD_TOKEN).catch((error) => {
    console.error("Erreur de connexion au bot Discord:", error);
});
