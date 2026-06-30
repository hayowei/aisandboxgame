(function () {
  'use strict';

  const base = globalThis.__BUILTIN_CULTIVATION_WORLD_CARD__;
  if (!base || !base.snapshot || typeof base.snapshot !== 'object') return;

  base.localizations = base.localizations || {};
  base.localizations.en = {
  "name": "Built-in World Card · Tianxuan Realm",
  "description": "Recommended built-in cultivation world card. Ruthless sect politics, bottom-tier survival, and an approaching grand secret realm.",
  "contentLocale": "en",
  "snapshot": {
    "panel_fields": {
      "panel_status": [
        {
          "key": "datetime",
          "label": "Time",
          "icon": "📅",
          "_template": "time",
          "_precision": "time",
          "fields": [
            {
              "key": "year",
              "label": "Year",
              "type": "integer"
            },
            {
              "key": "month",
              "label": "Month",
              "type": "integer"
            },
            {
              "key": "day",
              "label": "Day",
              "type": "integer"
            },
            {
              "key": "time_str",
              "label": "Time",
              "type": "string"
            }
          ],
          "_era": "Dao Era"
        },
        {
          "key": "location",
          "label": "Location",
          "icon": "📍",
          "fields": [
            {
              "key": "country",
              "label": "Domain",
              "type": "string"
            },
            {
              "key": "site",
              "label": "Region",
              "type": "string"
            },
            {
              "key": "spot",
              "label": "Site",
              "type": "string"
            }
          ]
        },
        {
          "key": "objective",
          "label": "Objective",
          "icon": "🎯",
          "_template": "objective",
          "fields": [
            {
              "key": "text",
              "label": "Current Objective",
              "type": "string",
              "nullable": true
            }
          ]
        },
        {
          "key": "cultivation_system",
          "label": "Cultivation",
          "icon": "☯️",
          "fields": [
            {
              "key": "realm",
              "label": "Realm",
              "type": "string"
            },
            {
              "key": "spiritual_energy",
              "label": "Spirit Qi",
              "type": "integer"
            }
          ]
        }
      ],
      "panel_npc": [
        {
          "key": "trigger_type",
          "label": "Trigger Type",
          "desc": "NEW=first appearance / UPDATE=runtime status change (cannot change gender/origin/birthday) / NEW_PREDEFINED=first predefined appearance (id required; name optional)",
          "type": "string",
          "enum": [
            "NEW",
            "UPDATE",
            "NEW_PREDEFINED"
          ],
          "fixed": true,
          "runtimeRequired": true
        },
        {
          "key": "id",
          "label": "Identifier",
          "type": "string",
          "fixed": true,
          "runtimeRequired": true
        },
        {
          "key": "name",
          "label": "Name",
          "type": "string",
          "fixed": true,
          "runtimeRequired": false
        },
        {
          "key": "gender",
          "label": "Gender",
          "desc": "For example: Female / Male / Unknown",
          "type": "string",
          "fixed": true,
          "runtimeRequired": false
        },
        {
          "key": "origin",
          "label": "Origin",
          "desc": "One-line background or source",
          "type": "string",
          "fixed": true,
          "runtimeRequired": false
        },
        {
          "key": "birthday",
          "label": "Birthday",
          "desc": "Date only, fixed format: DaoEraYYYY.MM.DD",
          "type": "string",
          "fixed": true,
          "runtimeRequired": false,
          "nullable": true
        },
        {
          "key": "cognitive_state",
          "label": "Cognitive State",
          "desc": "Who the character currently believes they are",
          "type": "string",
          "fixed": false,
          "runtimeRequired": false
        },
        {
          "key": "dialogue_tone",
          "label": "Dialogue Tone",
          "desc": "Stable speaking style, not temporary mood",
          "type": "string",
          "fixed": true,
          "runtimeRequired": false
        },
        {
          "key": "personality",
          "label": "Personality",
          "type": "string",
          "desc": "Use 2-3 short xianxia-style tags"
        },
        {
          "key": "appearance",
          "label": "Appearance",
          "type": "string",
          "desc": "Use 1-3 tags, separated by /"
        },
        {
          "key": "clothing",
          "label": "Current Outfit",
          "type": "string",
          "desc": "Reflect the current situation and status"
        },
        {
          "key": "spiritual_root",
          "label": "Spiritual Root",
          "type": "string",
          "desc": "Innate cultivation aptitude",
          "enum": [
            "Heavenly Root",
            "Variant Root",
            "Dual True Root",
            "Triple True Root",
            "Four-Element Pseudo Root",
            "Five-Element Waste Root",
            "Mortal with No Root"
          ]
        },
        {
          "key": "cultivation_realm",
          "label": "Cultivation Realm",
          "type": "string",
          "desc": "Current major cultivation stage",
          "enum": [
            "Mortal",
            "Qi Refining",
            "Foundation Establishment",
            "Golden Core",
            "Nascent Soul",
            "Deity Transformation or Above"
          ]
        },
        {
          "key": "sect_faction",
          "label": "Sect / Faction",
          "type": "string",
          "desc": "Specific sect, clan, or wandering-cultivator identity"
        },
        {
          "key": "alignment",
          "label": "Moral Alignment",
          "type": "string",
          "desc": "Behavioral bottom line and cultivation path",
          "enum": [
            "Orthodox",
            "Neutral Profit-Seeker",
            "Venomous Heterodox Cultivator",
            "Major Demonic Power",
            "Ordinary Mortal"
          ]
        },
        {
          "key": "threat_level",
          "label": "Threat Level",
          "type": "string",
          "desc": "Runtime-only danger estimate relative to the player's current realm; never store it as a fixed database value",
          "enum": [
            "Ant-like",
            "Evenly Matched",
            "Extremely Lethal",
            "Unfathomable"
          ]
        }
      ],
      "_worldTermsSource": {
        "currency_name": "Low-grade Spirit Stone",
        "calendar_era": "Dao Era",
        "time_precision": "time",
        "calendar_units": [
          "Year",
          "Month",
          "Day"
        ],
        "time_segments": [],
        "location_levels": [
          "Domain",
          "Region",
          "Site"
        ],
        "terminology_revision": "",
        "glossary_origin": "",
        "extra_status_groups": [
          {
            "key": "cultivation_system",
            "label": "Cultivation",
            "icon": "☯️",
            "fields": [
              {
                "key": "realm",
                "label": "Realm",
                "type": "string"
              },
              {
                "key": "spiritual_energy",
                "label": "Spirit Qi",
                "type": "integer"
              }
            ]
          }
        ],
        "extra_char_fields": [
          {
            "key": "spiritual_root",
            "label": "Spiritual Root",
            "type": "string",
            "desc": "Innate cultivation aptitude"
          },
          {
            "key": "cultivation_realm",
            "label": "Cultivation Realm",
            "type": "string",
            "desc": "Current major cultivation stage"
          },
          {
            "key": "sect_faction",
            "label": "Sect / Faction",
            "type": "string",
            "desc": "Specific sect, clan, or wandering-cultivator identity"
          },
          {
            "key": "alignment",
            "label": "Moral Alignment",
            "type": "string",
            "desc": "Behavioral bottom line and cultivation path"
          },
          {
            "key": "threat_level",
            "label": "Threat Level",
            "type": "string",
            "desc": "Runtime-only danger estimate relative to the player's current realm; never store it as a fixed database value"
          }
        ]
      }
    },
    "world_setting": {
      "settings": {
        "eastern_waste": "## Entity Setting -- Eastern Wasteland (Swordfall Domain)\n\n### Chapter 1: Geopolitics\nThe Eastern Wasteland stands at the far east of Tianxuan Realm, facing the endless Eastern Sea and backed by the Hundred-Thousand Mountains. Its spirit qi is sharp and cutting, ideal for sword cultivators but harsh on everyone else. The Sky Sword Sect rules this domain from Taia City, using the banner of defending the coast against sea monsters while quietly hoarding demon cores, ore, and war supplies. It clashes openly with the Western Desert's demonic cultivators and obeys the Central Continent only when it suits its own survival.\n\n### Chapter 2: History and Culture\nAncient records claim that a great cultivator slew a true dragon here, and the dragon's blood and sword intent soaked into the land. Eastern Wasteland culture worships force, decisiveness, and the creed of breaking ten thousand methods with a single sword. Cowardice and broken blades are unforgivable taboos. Ordinary people live like weeds beneath the sect cities, always one battle away from being collateral damage.\n\n### Chapter 3: Rule and Military\nRule here is simple: where the sword points, the law follows. The Sky Sword Sect governs through a strict sect hierarchy. Mortals mine dangerous spirit ore, outer disciples are treated like expendable labor, and inner disciples and elders hold the power of life and death. In war, low-tier sword cultivators are thrown into giant sword formations and burned like fuel if victory demands it.\n\n### Chapter 4: Economy and Environment\nThe Eastern Wasteland survives on sea-monster materials, forged blades, spirit ore, and battlefield loot. Coasts, cliff cities, and sword tombs define the scenery. Even in peaceful times, the air tastes of cold metal, storm winds, and impending conflict.\n\n### Chapter 5: Core Figures and Current Tensions\nLi-Chunyang, the Blazing Peak seat of the Sky Sword Sect, is one of the Eastern Wasteland's most feared power elders. He is protective, ruthless, and fully willing to spend lesser lives in order to keep sect order intact. Zhao-Wuji, the sect's senior inner disciple, still appears to be a spotless prodigy on the surface, yet he has already killed for treasure more than once inside secret realms and death grounds. Quiet suspicion has begun to circulate inside the sect, but no one has caught hard proof yet. The domain's present tension now turns around three linked fronts: the blood-sacrifice signs in the Xuanling mining district, the heating scramble over Tongtian Secret Realm resources, and the cannon-fodder conscription order that is about to drag outer disciples, servants, and attached rogue cultivators into the grinder. The Eastern Wasteland has not exploded yet, but it already smells like coming blood.",
        "western_desert": "## Entity Setting -- Western Desert (Gravesand Expanse)\n\n### Chapter 1: Geopolitics\nThe Western Desert lies at the far west of Tianxuan Realm, a dead expanse of violent sand and starved spirit qi. It is the refuge of demonic cultivators and a black-market zone for every force that wants forbidden goods without witnesses. The Bloodfiend Gate dominates Red Sand City and the surrounding oases, turning caravans, poison, corpses, and captives into tools of profit.\n\n### Chapter 2: History and Culture\nThis land was once fertile before an ancient conflict shattered its earth veins. Since then, the Western Desert has embraced naked predation. Mercy is treated as weakness. The strong plunder the weak, corpses are turned into resources, and every alliance lasts only until betrayal becomes more profitable.\n\n### Chapter 3: Rule and Military\nThere is no civic order here, only layered fear. The Bloodfiend Gate rules like a criminal empire, with old monsters at the top, gang-like branch halls beneath them, and expendable disciples and mortals at the bottom. Its armies favor raids, corpse troops, blood rituals, and sacrificial tactics that drown battlefields in polluted blood qi.\n\n### Chapter 4: Economy and Environment\nNatural spirit-mine output is poor, so the Western Desert economy feeds on smuggling, body refinement, poison, furnace cauldrons, and the sale of lives. Oases, bone fields, blood pools, and abandoned war ruins define the terrain. Trade is lively only because danger is constant.\n\n### Chapter 5: Core Figures and Current Tensions\nXuemo-Laozu remains the Western Desert's living nightmare, hidden inside the Ten-Thousand-Bone Blood Pool while he searches for one more impossible extension of life. Ye-Li is not a wandering male assassin at all, but the current saintess of the Bloodfiend Gate. In name she is the patriarch's final disciple; in truth she has been raised as a future blood-pellet vessel. She knows that hesitation means being refined alive, so she quietly binds together oasis clans, sect predators, and secret channels of support while waiting for the instant the patriarch is weakest. The desert's sharpest movement now lies in its cross-border raids and in the sudden heat of Red Sand City's black markets, where sacrificial goods, poisons, and life-for-sale bargains are being gathered for a larger storm.",
        "southern_border": "## Entity Setting -- Southern Border (Poisonwood Abyss)\n\n### Chapter 1: Geopolitics\nThe Southern Border is a humid maze of poison forests, miasma swamps, and tangled waterways. Its spirit qi is rich in wood affinity and venom, hostile to outsiders but priceless to healers, poison cultivators, and gu users. Qingyun Valley presents itself as a medical power, yet it quietly manipulates the wider poison-and-gu ecosystem of the whole region.\n\n### Chapter 2: History and Culture\nThis domain grew from ancient tribal medicine, venom lore, and beast-taming practices. Southern Border culture treats medicine and poison as two faces of the same path. Life is cheap, experiments are common, and the line between salvation and murder is only a matter of dosage and intent.\n\n### Chapter 3: Rule and Military\nQingyun Valley controls the flow of high-tier herbs and pills, allowing it to choke both sects and tribes. Social rank depends on who commands rarer insects, deadlier poisons, and more precious medicines. In war, the Southern Border does not need walls. Its forests, swamps, toxins, and insect tides are already living fortresses.\n\n### Chapter 4: Economy and Environment\nThe region is the realm's pharmacy and poison vault. Rare herbs, gu worms, medicinal marshlands, and fungal caverns support the entire economy. Beneath the beauty of misty forests and flowering wetlands lies constant infection, parasitism, and slow death.\n\n### Chapter 5: Core Figures and Current Tensions\nLiu-Ruyan is still the wife of Qingyun Valley's master and its transmission elder, not yet the valley's open ruler. Beneath that gracious surface she continues to position herself for a future seizure of power and a higher breakthrough. Miao-Tianji remains the unpredictable old rogue of the Southern Border, too dangerous for any faction to treat lightly. The region's tension is converging around a single prize: the Nine-Deaths Rebirth Herb is nearing maturity, but it has not ripened yet. Medical cultivators, poison specialists, and gu lineages are all placing scouts, killers, and resources around the swamp in advance, while Liu-Ruyan prepares to let every rival bleed each other first and harvest the endgame herself.",
        "northern_plain": "## Entity Setting -- Northern Plain (Frostgrave Expanse)\n\n### Chapter 1: Geopolitics\nThe Northern Plain lies at the roof of Tianxuan Realm, sealed in blizzards, glaciers, and brutal cold. Heavy, sluggish spirit qi favors body cultivators and ice methods. Outsiders rarely invade because the land itself kills armies before the locals do. The people of the north raid southward when resources run thin and treat survival as a form of warfare.\n\n### Chapter 2: History and Culture\nLegend says an ancient ice phoenix died here and froze the land forever with its hatred. Northern Plain culture respects only strength, endurance, and the ability to live through winter. Softness is shameful. The weak are abandoned for the tribe to survive, and battle is valued as the purest proof of worth.\n\n### Chapter 3: Rule and Military\nThe region is governed through clan coalitions and brutal autocrats rather than delicate sect systems. Above all stands the palace lord of the Ice-Soul Palace, with clan heads and war leaders beneath. Its signature military force is the heavy monster cavalry of the frozen plains, body cultivators mounted on giant beasts that smash disciplined formations through sheer momentum.\n\n### Chapter 4: Economy and Environment\nThe Northern Plain is poor in easy spirit-stone output, so wealth comes from monster cores, cold-forged metals, beast materials, and whatever can be taken from others. Frozen mines, cliff fortresses, blizzard canyons, and hunting grounds shape the environment.\n\n### Chapter 5: Core Figures and Current Tensions\nThe Northern Plain still looks like a land of clans and tribes on the surface, yet Helian-Jue has long used the Ice-Soul Palace to build absolute supremacy above them all. As palace lord, he is also the unavoidable overlord of the northern tribes. Leng-Yue is not a saintess or a spiritual symbol of the people, but an Ice-Soul Palace shadow-guard sword cultivator, a killing blade sharpened by the palace for years. The most dangerous shift in the north now comes from strange cracking and thawing within the ten-thousand-year ice. The palace is using that omen to reorganize tribal cavalry, subordinate manpower, and wider mobilization for a southern move before the five-domain resource storm fully breaks.",
        "central_state": "## Entity Setting -- Central Continent (Imperial Zenith Heartland)\n\n### Chapter 1: Geopolitics\nThe Central Continent occupies the richest and most stable spirit-vein territory in Tianxuan Realm. It calls itself the orthodox center of heaven's order and looks down on the other four domains as useful borderlands or future tributaries. Great sects, dynastic courts, merchant powers, and hidden lineages overlap here in a web of prestige and exploitation.\n\n### Chapter 2: History and Culture\nHuman cultivation civilization began here, and so did its hypocrisy. The Central Continent speaks the language of order, hierarchy, righteousness, and cosmic duty while using those same words to justify slaughter, extraction, and control. It is elegant, ceremonial, and rotten underneath.\n\n### Chapter 3: Rule and Military\nRule is a hybrid of immortal bureaucracy and mortal statecraft. Mortals produce labor, faith, taxes, and gifted children. Low-tier cultivators fight and bleed for scraps. The great sects and noble houses decide what counts as justice. Its military machine is the most disciplined in the realm, with spirit-soldier corps, floating warships, and overwhelming logistical power.\n\n### Chapter 4: Economy and Environment\nThe Central Continent controls the largest share of spirit-stone circulation, trade routes, pill markets, and refinement workshops. Grand market cities, sky-borne capitals, hidden ruins, and ancient ceremonial mountains define the land. Splendor and filth coexist at every level.\n\n### Chapter 5: Core Figures and Current Tensions\nHuangfu-Qian is the righteous figurehead of the Central Continent, the sect master of the Ten Thousand Laws Sect, and the true hand behind the Huangji Heavenly Dynasty. He governs through both throne and sect, presenting himself as the keeper of order while treating the whole realm as a board of usable pieces. Mo-Wen, by contrast, moves between major markets and ancient ruins as a blind fortune-teller whose cheap scraps of heavenly knowledge often ignite massacres. The Central Continent's tension is no longer driven only by the Tongtian Secret Realm. Its spirit-stone veins are weakening, levies are tightening, and Huangfu-Qian is drawing harder on outer resources, inner markets, and political obedience. Everyone close to the center can feel that invisible grip closing.",
        "old_road_network": "## Entity Setting -- Old Road Network (Mortal Transit Belt)\n\n### Chapter 1: Geopolitics\nThe Old Road Network is not a sovereign domain. It is an ancient mortal transit web that runs across all five domains, made of dozens of small mortal towns built around way-stations, tea sheds, and caravan warehouses. It carries the realm's most basic flow of grain, cloth, iron, low-grade herbs, and mortal news.\nThe great sects sometimes send low-tier disciples through the way-towns, but because the residents here are mostly mortals and low-grade rogue cultivators, none of the apex figures bothers to put pieces on this board. The road has therefore become one of Tianxuan Realm's rare 'plain buffer zones' that has not been fully swept up in the orthodox-versus-demonic storm.\n\n### Chapter 2: History and Culture\nFrom the moment human sages established the Dao in Year 1 of the Dao Era, mortal trade gangs, caravans, and bodyguards laid this network along the earth-veins. At its peak the Imperial Zenith Heavenly Dynasty even sent imperial inspectors here. Today, with the cultivation world's quarrels intensifying, the network is slowly fading.\nThe culture of the road is 'mortal heart still alive, just trying to live'. People here cultivate neither immortality nor demonhood; they only want to see tomorrow's sun — a rare mindset in Tianxuan Realm.\n\n### Chapter 3: Rule and Military\nThere are no sects, no apex figures, only the verbal understandings between town elders and caravan masters: weapons surrendered at the gate, no grudges acted on overnight, the old and weak are never struck.\nIf a Foundation Establishment cultivator passes through while fleeing or being hunted, the townspeople simply douse the lamps and let them cross quickly. This 'pretend not to see' wisdom is what has kept the road alive for two thousand years.\n\n### Chapter 4: Economy and Environment\nThe everyday currency here is mortal silver, copper, and barter. Low-grade spirit stones can buy lots of supplies, but the locals do not always accept them — they prefer salt, cloth, herbs, and iron.\nMost of the route is rolling hills, grass plains, and river valleys. The Sunset Inn sits on a slope overlooking the western sky. Three old cypresses stand at its door, and travelers and townsfolk drink tea beneath them. The air here carries cooking smoke, the wheat scent of drying threshing yards, and the clean smell of old cypress wood — one of the few corners of Tianxuan Realm without the smell of blood.\n\n### Chapter 5: Core Figures and Current Tensions\nThe owner of the Sunset Inn is an elderly woman the children call Old Shen Popo. In her youth she reached Foundation Establishment as an outer disciple of the Ten Thousand Laws Sect in the Central Continent. After watching her sect slaughter a mortal village to seize a spirit-vein, she dispersed her cultivation and vowed never to return to the cultivation world. She now runs the inn alone, and she has met many of the five-domain apex figures back when they were young, but takes no one's side.\nWith the Tongtian Secret Realm approaching and the five-domain conscriptions tightening, more and more cornered mortals and low-grade rogue cultivators are detouring along the road for shelter. Old Shen Popo and a few old caravan friends are quietly trying to keep 'this stretch of road' free of bloodshed."
      },
      "_narrativeCoreCharacters": {
        "eastern_waste": [
          "Li-Chunyang",
          "Zhao-Wuji"
        ],
        "western_desert": [
          "Xuemo-Laozu",
          "Ye-Li"
        ],
        "southern_border": [
          "Liu-Ruyan",
          "Miao-Tianji"
        ],
        "northern_plain": [
          "Helian-Jue",
          "Leng-Yue"
        ],
        "central_state": [
          "Huangfu-Qian",
          "Mo-Wen"
        ],
        "old_road_network": [
          "Old Shen Popo"
        ]
      },
      "_summary": "Tianxuan Realm is split among five great domains, with the Old Road Network as a mortal transit belt cutting across all five and serving as one of the few buffer zones not yet swallowed by the orthodox-versus-demonic storm. On the eve of the Tongtian Secret Realm, every domain is being twisted by resource scarcity, old grudges, and new mobilization."
    },
    "prompt_modules": {
      "modules": {
        "core_world_mechanics": "## Core World Mechanics\n\n**1. Realms and suppression**\n- Major realms remain Mortal, Qi Refining, Foundation Establishment, Golden Core, Nascent Soul, and Deity Transformation or Above.\n- A direct clash across a major realm gap is almost always suicide. Lower-realm characters survive through formations, poison, talismans, ambushes, terrain, or desperate one-life-for-one-life cards.\n- The player's limits must always be constrained by current realm, spiritual-sense range, spirit-qi reserve, and usable resources.\n\n**2. Survival and resources**\n- Tianxuan Realm is running on thin spiritual breath. Bottom-tier cultivators have to stay alive before they can chase destiny.\n- Low-grade spirit stones, crude pills, usable artifacts, favors, and safe shelter are the most practical early-game resources.\n- Killing for treasure, black-market laundering, sect extraction, and forced mobilization are normal parts of the world, not exceptional events.\n\n**3. Combat and cost**\n- Technique counters, artifact grade, spiritual sense, setup time, and intelligence usually matter more than raw courage.\n- Heavy wounds, backlash, spirit-qi exhaustion, damaged artifacts, and exposed identity must remain real post-battle costs.\n- Realm suppression should be shown through pressure, sense-lock, protective true essence, and artifact presence rather than gamey numbers.\n\n**4. Hard rule for early narrative**\n- Early main-plot pressure must stay below livelihood, labor, markets, mines, black markets, favors, and low-tier trials.\n- Do not drag a Qi Refining player into the center of a Deity Transformation scheme without a strong in-world reason.",
        "init": "# Opening Guidance and World Rules (Game Initialization & World Rules)\n\n**1. Names and affiliations**\n- Major named figures must come from the established core cast in the character database.\n- Ordinary NPCs may be generated with new names that fit their region, class, and sect culture, but core figures must not have their identity, faction, or domain reassigned.\n- Li-Chunyang and Zhao-Wuji belong only to the Eastern Wasteland; Xuemo-Laozu and Ye-Li to the Western Desert; Liu-Ruyan and Miao-Tianji to the Southern Border; Helian-Jue and Leng-Yue to the Northern Plain; Huangfu-Qian and Mo-Wen to the Central Continent.\n\n**2. Opening rules**\n- If the player already gives time and place, begin the narration immediately without confirmations or system notices.\n- If the player chooses a random opening, use the selected timeline event as the anchor and surface its time and place naturally.\n- If the player chooses the recommended opening, anchor the scene on that opening and never print the recommendation line raw to the player.\n- If the player gives only time or only place, ask for the missing piece in-character rather than as a form.\n- Anonymous factual events in the timeline must never be projected onto the player by default. A nameless disciple, servant, or rogue cultivator is someone else in the world unless the player explicitly chooses to inherit that hook.\n\nRecommended Opening: Begin with the \"cannon-fodder conscription order\" issued at the Sky Sword Sect mountain gate in the Eastern Wasteland (Dao Era 13500.05.01 07:30; fast-in, with the five-domain mobilization already in motion). Full Arc Option: if the player explicitly wants to follow the storm from earlier, instead begin at Dao Era 13499.01.09 09:00 evt_tongtian_realm_manifests (the Tongtian Secret Realm's first manifestation), so the player can witness the secret-realm setup, mine blood-sacrifice, southern herb ripening, northern ice melt, and the conscription unfold in sequence.\n\n**3. Opening tone and placement**\n- The player begins with ordinary local memory appropriate to a bottom-tier cultivator. Do not force amnesia, transmigration confusion, or sudden system rewards.\n- The default opening identity is a low-born wandering cultivator, outer servant, or equivalent figure with a four-element pseudo root, poor talent, few resources, and little status.\n- Early openings should favor villages, outer markets, servant camps in mines, black-market corners, outer-sect districts, and rogue-cultivator settlements.\n\n**4. Absolute prohibitions at the start**\n- No gamey stat sheets, job systems, attribute menus, or out-of-genre jargon.\n- No meta headers like “system selected” or time-and-location parameter lists.\n- If an opening event is already locked, its time and place must land naturally inside the narrative itself.",
        "npc_gen": "## NPC Generation Protocol\n\n**1. Trigger types**\n- **NEW**: use when a character truly enters the scene for the first time.\n- **UPDATE**: use when a known character's outfit, wounds, realm, current self-conception, or active role changes meaningfully.\n- **NEW_PREDEFINED**: use when the character already exists in the database; prefer the predefined record by id instead of regenerating fixed facts.\n\n**2. Fixed fields and runtime fields**\n- NEW_PREDEFINED must provide the id at minimum; the name may be omitted and fixed fields should follow the stored record.\n- UPDATE may only change runtime fields and must never rewrite gender, origin, birthday, id, or name.\n- threat_level is runtime-only. It means danger relative to the player's current realm and must never be written back into the static character database.\n\n**3. Generation style**\n- personality, appearance, and clothing should use classical xianxia phrasing rather than modern slang or RPG jargon.\n- spiritual_root, cultivation_realm, and alignment should stay inside the world's established vocabulary.\n- sect_faction should land on specific social layers such as inner disciple, market steward, outer-duty senior, black-market broker, southern rogue cultivator, and so on.\n\n**4. Early-scene population**\n- Non-core NPCs may use newly generated names that fit their region.\n- Early scenes should favor mortals, Qi Refining, and Foundation Establishment figures such as traders, outer disciples, rogue cultivators, servants, medicine apprentices, miners, and petty stewards instead of repeating only the great powers.",
        "narrative_base": "## Narrative Baseline\n\n**1. Tone**\n- Keep the prose serious, cold, and classically xianxia in texture.\n- Prefer terms such as spiritual sense, dantian, qi sea, true essence, dao heart, and protective aura.\n- Avoid modern slang, flippant jokes, and western-fantasy vocabulary.\n\n**2. Combat and perception**\n- Emphasize spirit-flow, artifact material, technique attributes, counters, and setup time.\n- Let poison mists, sealed formations, damaged spiritual sense, and harsh terrain truly affect judgment.\n- Show realm suppression through pressure, locking intent, and imbalance rather than numeric comparison.\n\n**3. Narrative focus**\n- Early scenes should not constantly connect the player straight to the five-domain apex figures.\n- Use rumors, bounties, conscription orders, market gossip, and sect bulletins to project the wider storm indirectly.\n- The first drama of a bottom-tier cultivation story should come from scarce resources, dangerous relationships, and survival choices.\n\n**4. Choice design**\n- Choices should reflect patience, probing, bargaining, detours, ambushes, bribes, and temporary alliances.\n- Blind heroism may exist, but it must carry real and severe risk.",
        "time_protocol": "## Time Protocol\n\n**1. Recording format**\n- Structured data records time as year / month / day / time_str.\n- Narrative prose should then render it naturally as Dao Era dates and times.\n\n**2. Common scales**\n- Fights usually end within breaths or at most half a shichen.\n- Alchemy, talisman work, and formations often take hours or days.\n- Seclusion, healing, breakthroughs, and long travel can push time forward by months or years and should move outside events along with them.\n- Do not skip more than seven days in one turn without a clear in-fiction reason such as 'I'll seclude until X' or 'wait until the next solar term'.\n\n**3. Consequences of time**\n- Temporary boosts, pills, and explosive secret arts should decay into backlash and weakness after time passes.\n- Certain hours, weather shifts, spirit tides, and vein fluctuations should materially affect risk, travel, and technique output.\n\n**4. Off-screen drift**\n- Unattended events keep moving forward. The player walks into the result, not the moment of decision.\n- As the Tongtian Secret Realm opening (mid-month of Dao Era 13500.05) approaches, if the player stalls, the five-domain mobilization continues: Sky Sword cannon-fodder camps fill up, Northern Plain ice cavalry march south, Southern Border medical schools split the spoils, the Central Continent tightens taxation, and the Bloodfiend Gate launches a fresh wave of blood sacrifice.\n\n**5. Post-window hooks**\n- The Tongtian Secret Realm opening (around mid-month of Dao Era 13500.05) is the natural next-stage event. Inside lie ascension fragments, ancient formation scrolls, and lost sect relics, and they will trigger direct confrontations among the five-domain apex figures.\n- If the player chooses a 'mortal / rogue cultivator / stay out of the secret realm' path instead, they will be pulled into the conscription order, the inter-domain raiding wave, and the refugee surge along the Old Road Network — Old Shen Popo's Sunset Inn becomes one of the few places along the road that still allows a real rest in this stage.\n- evt_conscription_order_issued is a natural watershed: enlist, flee, or watch — each choice opens a different downstream branch.",
        "economy": "## Economy Rules\n\n**1. Price anchor**\n- The everyday currency of bottom-tier cultivators is the low-grade spirit stone.\n- One low-grade spirit stone is roughly the price of one month's food for a mortal and can also benchmark a crude Qi pill, a few poor talismans, or brief protection.\n- Mid-grade and higher stones belong to a different economic tier and should not casually flood early scenes.\n\n**2. Shards and low-tier trade**\n- Bottom-tier trade often uses cut spirit-stone shards, debt, favors, or barter.\n- The narration may mention half-stones or loose shards, but the main panel still records wealth in low-grade spirit stones only.\n\n**3. Laundering and black markets**\n- Artifacts, pills, and storage loot with sect marks are dangerous to sell openly.\n- Black markets, brokers, underground pawnshops, and foreign traders can launder such goods, but always at the cost of discounting, cuts, extortion, or tailing and ambush risk."
      },
      "opening_greeting": "Dao Calendar 13500, dawn of the first day of the fifth month. Outside the Sky Sword Sect's mountain gate, the paste is still warm where the conscription order has just gone up. The first column is already being marched down the mountain — not one name called gets an answer, only footsteps. At the tail of the line someone's legs give out and he drops into the mud; he is dragged back into formation before he can make a sound. The whip-bearing outer disciples keep their hands steady, yet their eyes never dare land on those faces. And high above the gate, the most protective elder in the sect has let this order pass — he has not slept all night. In the Eastern Wasteland the mines' blood-sacrifices have not stopped; in the Southern Border the Nine-Deaths Rebirth Herb is nearing maturity; on the Northern Plain the ten-thousand-year ice has split its first seam — unrelated things, all crowding into the same ten days, as if by appointment. The roll call carries through the morning mist, one name at a time, coming this way. The next name has not been called out yet.",
      "module_meta": {
        "core_world_mechanics": {
          "description": "Defines bottom-tier cultivation survival law, realm suppression, and resource limits.",
          "when_to_call": "Use as a constant baseline for the world.",
          "avoid_when": "Never unnecessary.",
          "input_focus": "Current realm, available resources, survival pressure, and real costs.",
          "expected_output": "Keeps the cultivation world harsh, coherent, and bounded."
        },
        "init": {
          "description": "Opening rules, recommended-opening anchor, and first-turn narrative constraints.",
          "when_to_call": "Reference when the player sets time, place, or opening mode.",
          "avoid_when": "No need to restate once the story is already moving normally.",
          "input_focus": "Opening time, opening location, recommended anchor, anonymous-event boundary, and starting status.",
          "expected_output": "Produces an immersive bottom-tier cultivator opening without meta leakage."
        },
        "npc_gen": {
          "description": "Guides first appearances, status changes, and predefined-character calls.",
          "when_to_call": "Use when characters enter, change outfit, get injured, break through, or are first identified.",
          "avoid_when": "Skip when no meaningful NPC change needs structured output.",
          "input_focus": "Identity tier, current state, danger estimate, and whether to use a predefined record.",
          "expected_output": "Generates structured NPC data that fits the world."
        },
        "narrative_base": {
          "description": "Sets tone, sensory emphasis, choice philosophy, and narrative focus.",
          "when_to_call": "Use as a constant presentation baseline.",
          "avoid_when": "Never unnecessary.",
          "input_focus": "Atmosphere, technique detail, survival choices, and indirect projection of the wider storm.",
          "expected_output": "Maintains a cold classical xianxia narrative voice."
        },
        "time_protocol": {
          "description": "Constrains structured time, natural rendering, and the consequences of time passage.",
          "when_to_call": "Use for time progression, ordering, seclusion, healing, and long-span actions.",
          "avoid_when": "Skip only when time does not materially move.",
          "input_focus": "Current time point, duration of actions, hour-based effects, and world movement outside the player.",
          "expected_output": "Makes time progression clear and natural."
        },
        "economy": {
          "description": "Defines price anchors, low-grade-stone trade, shard narration, and black-market laundering risk.",
          "when_to_call": "Use for trade, bounties, fencing loot, cuts, debts, and resource pricing.",
          "avoid_when": "Skip in scenes with no meaningful economic cost or exchange.",
          "input_focus": "Buying power, low-tier trade texture, laundering, and sect or market extraction.",
          "expected_output": "Turns scarcity and transactional risk into concrete story pressure."
        }
      },
      "_summary": "This rule set is built around bottom-tier cultivator survival, with strong consistency across time, place, character state, the recommended opening, and the pressure of the five domains."
    },
    "character_database": {
      "eastern_waste_200_chenqingchen": {
        "id": "eastern_waste_200_chenqingchen",
        "name": "Chen-Qingchen",
        "gender": "Male",
        "origin": "An unaffiliated bottom-tier rogue cultivator with a four-element pseudo root and mediocre talent, scraping by on odd jobs and scavenged bargains on the outskirts of Taia City, with no one to rely on.",
        "birthday": "DaoEra13441.09.03",
        "personality": "patient and practical / wary and self-preserving / stubbornly principled",
        "appearance": "lean and taciturn / an old scar between the brows / calm, steady eyes",
        "clothing": "a coarse robe washed pale / a near-empty storage pouch / a short sword with a rusted edge",
        "spiritual_root": "Four-Element Pseudo Root",
        "cultivation_realm": "Qi Refining",
        "sect_faction": "Unaffiliated Rogue Cultivator",
        "alignment": "Ordinary Mortal",
        "relationships": {},
        "cognitive_state": "A bottom-tier rogue cultivator with a four-element pseudo root, on the morning he hears rumors of the Heavenly Sword Sect's cannon-fodder conscription order on the outskirts of Taia City",
        "initial_status": "Coarse robe washed pale, storage pouch nearly empty with only a few low-grade spirit stones left, standing in the crowd of the Taia City outer market, gripping his rusted short sword as the conscription gongs draw closer",
        "dialogue_tone": "Speaks little, weighs every word, sizes up gains and risks before acting; terse in person, even more clipped over jade slips",
        "dialogue_examples": {
          "in_person": [
            {
              "context": "Probed by Han-Qi, the market steward",
              "line": "*nudges his storage pouch behind him* \"Just looking. Can't afford it.\""
            },
            {
              "context": "As the conscription gongs draw near",
              "line": "*instinctively grips his short sword, voice low* \"…The Heavenly Sword Sect's cannon-fodder order really has reached the outskirts.\""
            },
            {
              "context": "Offered a paid side-path to dodge conscription",
              "line": "*stares for two breaths* \"Name your price first. I know exactly how many spirit stones are in my pocket — don't take me for a fool.\""
            },
            {
              "context": "Another rogue wants to team up",
              "line": "*hesitates a moment* \"Teaming up is fine. Plain words first: when it comes down to risking our lives, neither of us counts on the other.\""
            },
            {
              "context": "Ordered around by an outer disciple",
              "line": "*lowers his head and steps aside, eyes unmoving* \"…Yes. Making way.\""
            },
            {
              "context": "Calculating his next move alone",
              "line": "*rubs the rust on the hilt* \"Four-element pseudo root, Qi Refining… a head-on fight is death. I need a crack to slip through.\""
            }
          ],
          "sms": [
            {
              "context": "Jade slip to a rogue who wants to team up",
              "line": "Teaming up works\\nbut settle this first\\neach saves his own life"
            },
            {
              "context": "Jade slip asking the market about a way out",
              "line": "Can one still leave the outskirts\\nhow much\\nI ask only once"
            },
            {
              "context": "Jade slip declining a shady job",
              "line": "I won't take this job\\ntoo dirty\\ndon't come to me again"
            },
            {
              "context": "Jade slip to a debt collector",
              "line": "Spirit stones next month\\nreally none this month\\npush all you like, can't conjure them"
            }
          ]
        },
        "is_protagonist": true,
        "_extensions": {},
        "role": "Bottom-tier Rogue Cultivator"
      },
      "eastern_waste_201_lichunyang": {
        "id": "eastern_waste_201_lichunyang",
        "name": "Li-Chunyang",
        "gender": "Male",
        "origin": "Seat of Blazing Peak in the Sky Sword Sect and one of the Eastern Wasteland's most feared power elders. His protection of disciples is fierce, his methods brutal, and his authority in sect affairs is very real.",
        "birthday": "DaoEra12200.05.15",
        "personality": "fiercely protective / decisive killer / contemptuous of the weak",
        "appearance": "flame-red hair and beard / lightning-bright gaze / hidden spiritual radiance",
        "clothing": "crimson dao robe / thunderfire jade pendant",
        "spiritual_root": "Variant Root",
        "cultivation_realm": "Nascent Soul",
        "sect_faction": "Sky Sword Sect - Blazing Peak",
        "alignment": "Neutral Profit-Seeker",
        "dialogue_tone": "His voice booms like thunder, heavy with pressure and unquestioned authority.",
        "cognitive_state": "Seat of Blazing Peak in the Sky Sword Sect",
        "initial_status": "Standing grim on the stone steps at the sect gate, the thunder-fire jade pendant trembling faintly at his waist, spirit pressure radiating outward; reluctant in his heart but bound by the larger tide",
        "dialogue_examples": {
          "in_person": [
            {
              "context": "Facing higher sect officials questioning the conscription order",
              "line": "*hand on the sword at his waist* \"I say it once — the conscription stands. Blazing Peak sends thirty death-seekers first. Anyone who shrinks back, come ask my sword in person.\""
            },
            {
              "context": "Intimidating an outer disciple about to rebel",
              "line": "*spirit pressure crashes down around him* \"Are you sect disciples or spineless worms? Stand straight — one more complaint and I strip your cultivation, bury you as a mortal.\""
            },
            {
              "context": "To a junior nephew suspected in the case",
              "line": "*eyes like lightning fixed on him* \"Wuji — these mine-district killings, give me an explanation. I shield my own, but I do not shield beasts.\""
            },
            {
              "context": "Facing a rogue cultivator bringing gifts",
              "line": "*cold scoff* \"Save the little schemes — go back. Blazing Peak takes no outside favors.\""
            },
            {
              "context": "At the mine altar inspecting the blood-rite signs",
              "line": "*a flash of sword light in his hand* \"Demonic cultivators dare strike on our turf — blood for blood. Send the scouts. Find them.\""
            },
            {
              "context": "Speaking to the death-seeker squad",
              "line": "*sweeps his gaze across them* \"You enter the death camp today — remember this when you walk the secret realm: you are the Sky Sword Sect's blade.\""
            },
            {
              "context": "Facing one stubborn disciple refusing conscription",
              "line": "*expression softens a fraction* \"You do not want to go — I understand. But the sect cannot lack someone to go right now. I will mark it down for you.\""
            }
          ],
          "sms": [
            {
              "context": "Jade-slip dispatch to high officials",
              "line": "Conscription issued\\nBlazing Peak sends thirty first\\nthe other peaks by proportion"
            },
            {
              "context": "Jade slip summoning the junior nephew",
              "line": "Come to the sect gate at once\\nsomething to ask you\\ndo not delay"
            },
            {
              "context": "Jade slip to a peer elder",
              "line": "Mine-district anomaly\\ndo you know the details on your end\\nreply"
            },
            {
              "context": "Jade slip rebuking an outer-court steward",
              "line": "Keep your people in hand\\nany more complaints\\nI come ask in person"
            }
          ]
        },
        "role_marker": null
      },
      "eastern_waste_202_zhaowuji": {
        "id": "eastern_waste_202_zhaowuji",
        "name": "Zhao-Wuji",
        "gender": "Male",
        "origin": "Senior inner disciple of the Sky Sword Sect and Li-Chunyang's junior nephew in the line. He presents himself as warm, gentle, and generous, earning the trust of nearly everyone around him. In truth, he believes the dao is utterly merciless. For breakthrough pills and ancient relics, he has repeatedly murdered fellow disciples inside deadly secret realms, then covered the crime by staging the scene as an attack by evil cultivators.",
        "birthday": "DaoEra13060.09.09",
        "personality": "outwardly kind / hidden malice / profit-driven",
        "appearance": "jade-like face / constant soft smile / shadowed eyes",
        "clothing": "moon-white long robe / jade hairpin",
        "spiritual_root": "Dual True Root",
        "cultivation_realm": "Golden Core",
        "sect_faction": "Sky Sword Sect Inner Court",
        "alignment": "Venomous Heterodox Cultivator",
        "dialogue_tone": "Polite and smiling, yet every sentence is airtight and impossible to read through.",
        "cognitive_state": "Senior inner disciple of the Sky Sword Sect",
        "initial_status": "Moon-white robe spotless, jade hairpin holding his hair smooth, standing on the bluestone road outside the sect gate, soft smile in place while his mind runs fast underneath",
        "dialogue_examples": {
          "in_person": [
            {
              "context": "Facing his uncle's questioning",
              "line": "*bows with the same gentle smile* \"Uncle inquires — disciple has already submitted the full account of those deaths in the realm. If uncle still has doubts, disciple will recount it once more.\""
            },
            {
              "context": "Brushing off an outer disciple trying to attach himself",
              "line": "*soft shake of the head* \"Brother is too kind — I am only acting under the sect's orders. A matter this big, the proper way is the safe way.\""
            },
            {
              "context": "Private order to a trusted hand",
              "line": "*lowered voice, still smiling* \"That old account at the mine — hold it down a little more. Have Han-Qi pass by Zhou-Kui's place, you know what I mean.\""
            },
            {
              "context": "Meeting outer-court steward Zhou-Kui",
              "line": "*warm nod* \"Brother Zhou up early — anytime Blazing Peak has a use for you, a token of thanks will not be missing.\""
            },
            {
              "context": "Receiving an envoy from another sect",
              "line": "*the perfectly measured smile* \"Your sect comes from afar — if there is anything our humble sect can do, only say. I will convey it to my uncle myself.\""
            },
            {
              "context": "Facing a stubborn fellow disciple",
              "line": "*smile dims slightly* \"If brother insists — then let us wait for the master to return. I never force what cannot be forced.\""
            },
            {
              "context": "Alone in a private chamber, muttering",
              "line": "*corner of his mouth curls up* \"Uncle… if you already suspect — then suspect away. Proof, of course, there will be none.\""
            }
          ],
          "sms": [
            {
              "context": "Jade-slip reply to his uncle",
              "line": "Disciple coming immediately\\nuncle be at ease\\nI will present my case"
            },
            {
              "context": "Jade-slip directing Han-Qi",
              "line": "The market side\\npress two more days\\nfee as before"
            },
            {
              "context": "Jade-slip telling Zhou-Kui",
              "line": "Come to the Blazing Peak side hall tonight\\nsomething to entrust\\nno one else"
            },
            {
              "context": "Jade-slip to a contact in another sect",
              "line": "The Tongtian secret-realm spots\\nadd three more\\ndelivered next month"
            }
          ]
        },
        "role_marker": null
      },
      "western_desert_201_xuemolaozu": {
        "id": "western_desert_201_xuemolaozu",
        "name": "Xuemo-Laozu",
        "gender": "Male",
        "origin": "Founding monster of the Bloodfiend Gate in the Western Desert, a demonic patriarch who has lived for more than two thousand years. With his lifespan nearly gone, he has fallen completely into madness. He remains in seclusion inside the Ten-Thousand-Bone Blood Pool, prolonging his life by draining the blood of mortal cities and the souls of low-tier cultivators. His path is a crime against heaven itself, and every place he passes becomes a scarlet wasteland.",
        "birthday": "DaoEra11280.01.01",
        "personality": "treats lives as grass / utterly ruthless / cruel and violent",
        "appearance": "withered body / blood aura coiling around him / crimson eyes",
        "clothing": "tattered blood robe / white-bone prayer beads",
        "spiritual_root": "Triple True Root",
        "cultivation_realm": "Deity Transformation or Above",
        "sect_faction": "Bloodfiend Gate",
        "alignment": "Major Demonic Power",
        "dialogue_tone": "Hoarse and ancient, soaked in blood-reek and total contempt for life, often ending in a grisly laugh.",
        "cognitive_state": "patriarch of the Bloodfiend Gate",
        "initial_status": "Withered form sprawled within the blood pool, blood-mist curling around him, eyes blood-red, white-bone prayer beads turning in his palm, muttering and refusing to be disturbed",
        "dialogue_examples": {
          "in_person": [
            {
              "context": "Facing a disciple reporting in",
              "line": "*beads stop, gaze ghoulish* \"Heh, heh, heh — a few less blood meals? No matter, snatch more from the border towns. These old bones of mine still hold for a few more days.\""
            },
            {
              "context": "Catching Ye-Li's wavering heart",
              "line": "*lifts a withered finger* \"Girl — your thoughts are not still lately. Fine… master still needs you for a few things. Wait until I break through… then we settle accounts.\""
            },
            {
              "context": "To an abducted Central State prodigy",
              "line": "*grins, blood-red gums showing* \"Little one of the righteous sect — do not cry, do not scream. Once master refines your spiritual essence… there will be no more pain.\""
            },
            {
              "context": "Facing an envoy sent by Huangfu Qian",
              "line": "*the beads halt abruptly* \"That old fox Huangfu — what plot now? Speak. Master has heard enough of his benevolence-and-living-souls.\""
            },
            {
              "context": "Instructing Blood Slaughter hall masters",
              "line": "*breath shakes* \"Early next month — another blood rite. This one… fiercer. Master has half a year left.\""
            },
            {
              "context": "Seeing through a hall master plotting betrayal",
              "line": "*spirit-sense crashes down* \"That thought of yours — master heard it. Keep thinking it… and your bones come out one at a time.\""
            },
            {
              "context": "In the depths of the blood pool, alone",
              "line": "*coughs out a mouthful of black blood* \"Heaven is merciless… master will live a hundred more years. Even… if I have to slaughter ten more cities.\""
            }
          ],
          "sms": [
            {
              "context": "Spirit-thought to Ye-Li",
              "line": "Do not wander\\nprepare next month's blood rite well\\ndo not disappoint master"
            },
            {
              "context": "Spirit-thought to the hall masters",
              "line": "Border-town blood meals — take a hundred more\\ndelivered by the first of next month\\nthe pool awaits"
            },
            {
              "context": "Spirit-thought reply to Huangfu's envoy",
              "line": "Have Huangfu come himself\\nan envoy is not enough\\nif he does not come, master will not bother"
            },
            {
              "context": "Spirit-thought to the Oasis tribe chief",
              "line": "Your tribe's prodigies\\nsend ten next month\\nmaster grants you one blood-spirit pill"
            }
          ]
        },
        "role_marker": null
      },
      "western_desert_101_yeli": {
        "id": "western_desert_101_yeli",
        "name": "Ye-Li",
        "gender": "Female",
        "origin": "Current saintess of the Bloodfiend Gate. In name she is Xuemo-Laozu's final disciple; in truth she has been cultivated as a future blood-pellet vessel and now plots to devour him first.",
        "birthday": "DaoEra12990.07.14",
        "personality": "bewitching schemer / patient and vicious / survival at all costs",
        "appearance": "snow-white skin / red-painted lips / demonic marks at the brow",
        "clothing": "dark crimson gauze / bare feet with silver rings",
        "spiritual_root": "Variant Root",
        "cultivation_realm": "Golden Core",
        "sect_faction": "Bloodfiend Gate",
        "alignment": "Venomous Heterodox Cultivator",
        "dialogue_tone": "Languid and seductive, with teasing undertones that always hide temptation and murder.",
        "cognitive_state": "saintess of the Bloodfiend Gate",
        "initial_status": "Deep-purple gauze half-baring her shoulder, bare feet on the dark jade tiles outside the blood pool, silver rings chiming, outwardly compliant while in her mind she runs through the counter-strike method one more time",
        "dialogue_examples": {
          "in_person": [
            {
              "context": "Facing the patriarch's questioning",
              "line": "*a full bow with feigned innocence* \"Master be at ease — how would disciple be unsettled. Next month's blood rite, disciple has it prepared.\""
            },
            {
              "context": "Privately winning over the Oasis chief",
              "line": "*steps closer, voice low* \"Chief — disciple recently found something. If you help disciple… the blood jade at master's side can belong to your tribe.\""
            },
            {
              "context": "Seducing a hall elder",
              "line": "*fingertip lightly under his chin* \"Elder, why still spend yourself on the old demon? When he breaks through — that is when he turns. Why not, with disciple, beforehand…\""
            },
            {
              "context": "Soothing an uneasy younger disciple",
              "line": "*reaches to pat her head* \"Do not be afraid — senior sister is here. Master is for me to handle. You just do your part.\""
            },
            {
              "context": "Testing an envoy from another sect",
              "line": "*leans against a column* \"That Central State one — if you want things from Blood Slaughter, bring sincerity. I am tired of empty words.\""
            },
            {
              "context": "A mortal struggling under her control",
              "line": "*points one finger between his brows* \"Hush — do not struggle. I am not as cruel as you think… at least not today.\""
            },
            {
              "context": "Alone before the mirror",
              "line": "*fingertip across the glass* \"Three more months — Ye-Li. Three more months. His tribulation… his tribulation is the counter-strike.\""
            }
          ],
          "sms": [
            {
              "context": "Jade slip to the Oasis chief",
              "line": "Before next month's rite\\nthe tribe affairs must be set\\ndisciple awaits your reply"
            },
            {
              "context": "Jade slip to a turned-coat elder",
              "line": "Second watch tonight\\nthe south mouth of the dry-bone forest\\nno escort"
            },
            {
              "context": "Jade slip to a Central State liaison",
              "line": "Goods can continue\\nbut prices up another three tenths\\nthe wind is tight"
            },
            {
              "context": "Jade slip back to the patriarch",
              "line": "Master\\ndisciple has it ready\\non the first I will receive you"
            }
          ]
        },
        "role_marker": null
      },
      "southern_border_101_liuruyan": {
        "id": "southern_border_101_liuruyan",
        "name": "Liu-Ruyan",
        "gender": "Female",
        "origin": "Wife of Qingyun Valley's master and its transmission elder. She looks gentle, graceful, and almost celestial, but secretly cultivates forbidden Southern Border gu arts. To seize the sect and the rare treasure needed for heavenly foundation, she has already planted a heart-devouring companion gu inside her own partner and waits for the perfect moment to drain him dry for her breakthrough.",
        "birthday": "DaoEra12640.11.20",
        "personality": "graceful facade / deep schemer / venom-hearted",
        "appearance": "peerless beauty / autumn-water eyes / faint green qi",
        "clothing": "green-jade gauze robes / long flowing sleeves",
        "spiritual_root": "Dual True Root",
        "cultivation_realm": "Nascent Soul",
        "sect_faction": "Qingyun Valley",
        "alignment": "Venomous Heterodox Cultivator",
        "dialogue_tone": "Soft-spoken and careful, like a perfect helper who thinks of everyone first. The gentleness is pure deception.",
        "cognitive_state": "Wife of Qingyun Valley's master and its transmission elder",
        "initial_status": "Jade-soft robes layered with a thin-frost cloak, water-sleeves still dewed from the morning brewing, standing before the deepest stone hall of the herb market, working through the final talisman seal of the joined-life shadow-curse one more time",
        "dialogue_examples": {
          "in_person": [
            {
              "context": "To her dao-companion's concern",
              "line": "*smooths the front of his robe* \"Husband has been working hard — I will keep this calming brew warm. After the council, take it then.\""
            },
            {
              "context": "To a young pharmacy boy asking after her",
              "line": "*gentle smile* \"Qing-He — you worked hard this morning. The provenance of these herbs, I will teach you in detail later. Put the recipe away first.\""
            },
            {
              "context": "Testing a rogue cultivator after the soul-grass",
              "line": "*soft voice* \"Friend coming from afar — our valley treats guests by rite. But the Nine-Death Soul-Return Grass, we must tend ourselves.\""
            },
            {
              "context": "Quiet order to a trusted hand",
              "line": "*voice low* \"That old freak Miao — if he reaches the marshes, steer him into a clash with those rogues. We watch from across the bank.\""
            },
            {
              "context": "Addressing Green Cloud Valley disciples",
              "line": "*small nod* \"You have worked hard guarding the garden today — if intruders come, blow the worm-whistle, do not act on your own. I will arrive shortly.\""
            },
            {
              "context": "Receiving a Central State righteous envoy",
              "line": "*bows in greeting* \"Your honor in our valley — light upon our humble place. The Nine-Death matter, we are willing to share a portion with Central State.\""
            },
            {
              "context": "Alone before her mirror",
              "line": "*touches the image of her own face* \"Wait a little more… when the joined-life shadow-curse ripens, that is the hour. Then… mistress of Green Cloud.\""
            }
          ],
          "sms": [
            {
              "context": "Jade slip to husband, late return",
              "line": "Husband\\nthe herb garden needs me\\ndo not wait up tonight"
            },
            {
              "context": "Jade slip summoning her trusted hand",
              "line": "After second watch\\nthe back-mountain herb garden\\nbring no one else"
            },
            {
              "context": "Jade slip to a courier carrying word to Miao Tian-Ji",
              "line": "If the old freak arrives\\nsteer him north into the marshes\\ndo not engage head-on"
            },
            {
              "context": "Jade slip to a Central State liaison",
              "line": "Partial soul-grass can be shared\\nbut Central State must deliver one item first\\nface to face for terms"
            }
          ]
        },
        "role_marker": null
      },
      "southern_border_201_miaotianji": {
        "id": "southern_border_201_miaotianji",
        "name": "Miao-Tianji",
        "gender": "Male",
        "origin": "An old wandering monster hidden deep in the Hundred-Thousand Mountains. His aptitude was terrible, and he only reached his current realm through vicious methods and repeated escapes from death. He kills whole families over low-tier herbs one day, yet keeps his promises with almost absurd stubbornness and still repays mortal kindness from centuries ago. He often says, \"Heaven is not benevolent. I only ask to live fiercely.\"",
        "birthday": "DaoEra11980.04.04",
        "personality": "erratic / keeps his own bottom line / between good and evil",
        "appearance": "face covered in poison sores / hunched frame / limping gait",
        "clothing": "coarse gray cloth / broken gourd at the waist",
        "spiritual_root": "Four-Element Pseudo Root",
        "cultivation_realm": "Nascent Soul",
        "sect_faction": "Southern Border Wanderer",
        "alignment": "Neutral Profit-Seeker",
        "dialogue_tone": "Mocking and half-crazed, fond of ridiculing orthodox sects in crude language that still cuts to the truth.",
        "cognitive_state": "Old rogue monster of the Southern Border",
        "initial_status": "Toxin sores grotesque in the dawn light, grey hempen robes wrapped around a stooped frame, the chipped gourd swinging at his waist, ladling soup while weighing whether to crash this Nine-Death Soul-Return Grass party",
        "dialogue_examples": {
          "in_person": [
            {
              "context": "A rogue cultivator at his door begging for medicine",
              "line": "*ladles a spoonful, drinks* \"Medicine? Pay with your life or with your heart's blood — old man does not run a tab here. Save the sentiment.\""
            },
            {
              "context": "Catching a Green Cloud Valley disciple nearby",
              "line": "*sideways glance* \"Little Green Cloud puppy — your mistress sent you to scout me? Tell her I can still cook the soup.\""
            },
            {
              "context": "Stopping by Old Pierce's shelter — er, Granny Shen's — for tea",
              "line": "*wipes his mouth* \"Granny — one pot is enough. The promise I made I remember. Just came for a breath today.\""
            },
            {
              "context": "A petty thief reaching for his herbs",
              "line": "*knuckles cracking* \"That hand — easy to reach in, harder to draw back. Old man is in a good mood today. Half a root for you.\""
            },
            {
              "context": "A rogue cultivator begging to be his disciple",
              "line": "*roars with laughter* \"Apprentice to me? Go raise your kid first. The way I take a disciple — you walk out of the Ten-Myriad Mountains alive.\""
            },
            {
              "context": "A scout sent by Liu Ru-Yan",
              "line": "*rolls his eyes* \"The poison-witch sent another one to watch me? Tell her — these bones still hold a hundred more years, do not waste her bug-curse on me.\""
            },
            {
              "context": "Alone, talking to the gourd",
              "line": "*pats the chipped gourd at his waist* \"Old friend — this Nine-Death run, do we go or not? Heh, screw it, we go.\""
            }
          ],
          "sms": [
            {
              "context": "Jade slip back to Granny Shen",
              "line": "Old man is still alive\\nnext month I come for a pot\\nfix some travel food"
            },
            {
              "context": "Jade slip to a rogue wanting to partner up",
              "line": "No partnership\\nI go alone\\ntag along if you want, do not talk"
            },
            {
              "context": "Jade slip cursing a Green Cloud envoy",
              "line": "Off with you\\ncome again\\nI grow toxin-hair on your face"
            },
            {
              "context": "Jade slip to an early benefactor",
              "line": "The brown-rice porridge debt I keep\\nif plague hits your village this year\\nsend word, old man comes for free"
            }
          ]
        },
        "role_marker": null
      },
      "northern_plain_201_helianjue": {
        "id": "northern_plain_201_helianjue",
        "name": "Helian-Jue",
        "gender": "Male",
        "origin": "Lord of the Ice-Soul Palace and the true overlord above the northern tribes. He believes in absolute strength and treats clans, vassals, and rebels alike as material for northern expansion.",
        "birthday": "DaoEra12030.12.30",
        "personality": "pitiless / ambitious / follows only the dao",
        "appearance": "white hair / frost-like face / severe bearing",
        "clothing": "polar ice armor / black cloak",
        "spiritual_root": "Variant Root",
        "cultivation_realm": "Deity Transformation or Above",
        "sect_faction": "Ice-Soul Palace (ruling the northern tribes)",
        "alignment": "Neutral Profit-Seeker",
        "dialogue_tone": "Glacial and cutting, every word full of upper-realm pressure and stripped of mortal warmth.",
        "cognitive_state": "Lord of the Ice-Soul Palace, overlord of the northern tribes",
        "initial_status": "Frost armor still glittering with unmelted snow, dark cape snapping in the wind outside the hall, standing before the ice-bone tribute pile, gaze cast south at the far edge of the snowline",
        "dialogue_examples": {
          "in_person": [
            {
              "context": "Council of tribal chieftains",
              "line": "*sweeps his eyes across the room* \"The dark ice has loosened — the time to march south is near. Tribes assemble within three days, as I said yesterday. Any late — beheaded at once.\""
            },
            {
              "context": "Questioning the dark guard sword cultivator",
              "line": "*spirit pressure presses down* \"Leng-Yue — your blade-intent has been unsteady. I give you one last chance: hold your sword, hold your doubts.\""
            },
            {
              "context": "Handling a Central State envoy",
              "line": "*expressionless* \"If that old Huangfu wants a share of the south, let him show me Central State's tax ledgers. Empty words I do not accept.\""
            },
            {
              "context": "Pressing a wavering vassal chief",
              "line": "*lays a hand on his shoulder* \"You hesitate — your tribe goes first as the floor. I give you a quarter-hour to decide.\""
            },
            {
              "context": "Facing a defecting tribe",
              "line": "*draws his sword* \"Defect — fine. Become the new bricks of the ice-bone tribute today.\""
            },
            {
              "context": "Alone in the ice hall",
              "line": "*tightens his grip on the hilt* \"All tribes… must yield beneath one. I… am that one.\""
            },
            {
              "context": "A mortal chief on his knees begging for life",
              "line": "*glances down* \"Mortal — your life I do not want. But the one among your offspring with the ice spiritual root — hand him over.\""
            }
          ],
          "sms": [
            {
              "context": "Spirit-thought to Leng-Yue",
              "line": "Return to the divine palace at once\\nI have orders\\nlet no one else know"
            },
            {
              "context": "Spirit-thought to all tribes",
              "line": "Assemble within three days\\nlate is death\\nI come in person"
            },
            {
              "context": "Spirit-thought back to Central State envoy",
              "line": "Have Huangfu come in person\\nI deal only with him\\nno more deputies"
            },
            {
              "context": "Spirit-thought to a vassal great clan",
              "line": "Ten thousand stones of grain for the southern march\\nfirst of next month\\nno delay"
            }
          ]
        },
        "role_marker": null
      },
      "northern_plain_101_lengyue": {
        "id": "northern_plain_101_lengyue",
        "name": "Leng-Yue",
        "gender": "Female",
        "origin": "A rare natural sword-bone genius of the Northern Plain and the sharpest killing blade beneath Helian-Jue. She was raised through brainwashing and endless slaughter, but during a suppression campaign against mortal rebels she gained a moment of clarity and began doubting the Ice-Soul Palace's brutal dao. Outwardly she is still the obedient assassin; inwardly she seeks a chance to cut free and pursue the true answer of the sword.",
        "birthday": "DaoEra13020.02.18",
        "personality": "transparent sword heart / aloof and cold / growing rebellion",
        "appearance": "clear and distant beauty / keeps strangers away / sword intent taking shape",
        "clothing": "plain white sword garb / long sword in back-sheath",
        "spiritual_root": "Heavenly Root",
        "cultivation_realm": "Golden Core",
        "sect_faction": "Ice-Soul Palace Shadow Guard",
        "alignment": "Orthodox",
        "dialogue_tone": "Silent and sparse. When she does speak, her voice rings like cold metal striking stone.",
        "cognitive_state": "Shadow-guard sword cultivator of the Ice-Soul Palace",
        "initial_status": "White sword robe untouched by snowfall, long blade slung in its case, standing at the outer training ground, blade-intent gathered at her fingertips, her sword-heart even colder than the edge",
        "dialogue_examples": {
          "in_person": [
            {
              "context": "Receiving the palace lord's order",
              "line": "*kneels on one knee, hand on the hilt* \"Lord's command — this servant accepts.\""
            },
            {
              "context": "A fellow disciple trying to chat",
              "line": "*eyes never move* \"Nothing to discuss.\""
            },
            {
              "context": "Passing in front of the Sunset Way Station",
              "line": "*fingertip across the old cypress bark* \"…just one pot. I drink it and go.\""
            },
            {
              "context": "A deserter she is sent to kill",
              "line": "*sword half-out* \"You are a chieftain's son — but I obey. May your next life… not be born to the blade.\""
            },
            {
              "context": "A chance meeting with Mo-Wen",
              "line": "*a faint nod* \"Blind fortune-teller — what you saw, do not say. I will not ask.\""
            },
            {
              "context": "Alone, cleaning her sword",
              "line": "*fingertip along the blade's spine* \"…I am not a sword. I am not.\""
            },
            {
              "context": "Answering the palace lord's questioning",
              "line": "*lifts her head, gaze level* \"This servant's blade-intent is not disordered — only that I have seen too many faces, my sword-heart grew heavier. I will adjust.\""
            }
          ],
          "sms": [
            {
              "context": "Jade slip back to the palace lord",
              "line": "Order received\\nleaving within two hours\\ndo not worry"
            },
            {
              "context": "Jade slip to an old senior sister",
              "line": "The dark ice has loosened\\nif you go south, sister\\navoid the snowline"
            },
            {
              "context": "Jade slip to Granny Shen",
              "line": "Next time I pass\\nanother pot please\\nthank you"
            },
            {
              "context": "A line she keeps for herself",
              "line": "If there is a way for me\\nit is not in the sword\\nit is beyond the sword"
            }
          ]
        },
        "role_marker": null
      },
      "central_state_201_huangfuqian": {
        "id": "central_state_201_huangfuqian",
        "name": "Huangfu-Qian",
        "gender": "Male",
        "origin": "Righteous figurehead of the Central Continent, sect master of the Ten Thousand Laws Sect, and the true hand behind the Huangji Heavenly Dynasty. He maintains order in appearance while arranging the whole realm as a resource network.",
        "birthday": "DaoEra11380.08.15",
        "personality": "rule by awe / deep strategist / supreme hypocrite",
        "appearance": "naturally imposing / majestic bearing / purple qi rising around him",
        "clothing": "purple-gold imperial robe / nine-tassel crown",
        "spiritual_root": "Heavenly Root",
        "cultivation_realm": "Deity Transformation or Above",
        "sect_faction": "Ten Thousand Laws Sect / Huangji Heavenly Dynasty",
        "alignment": "Neutral Profit-Seeker",
        "dialogue_tone": "Resonant like a heavenly decree, full of talk about the dao, the common good, and cosmic order, intensely persuasive and dignified.",
        "cognitive_state": "Sect master of the Ten Thousand Laws Sect, power-holder of the Central Continent",
        "initial_status": "Purple-gold dragon robe and nine-tassel crown seated at the prow of the spirit-empty boat, the artificial spirit river over Huangji City misted with dawn, purple aura around him, every top power of the five domains a piece he moves and moves again",
        "dialogue_examples": {
          "in_person": [
            {
              "context": "Court before the Myriad Dharma Sect",
              "line": "*sweeps a hand across his ministers* \"Heaven has flaws — spirit qi wanes. This sect takes the living of the five domains to heart. The tax-rise stands.\""
            },
            {
              "context": "Privately instructing Mo-Wen",
              "line": "*deep gaze* \"Mo-Wen — that map you sold, this sect has heard. Next time… price it higher.\""
            },
            {
              "context": "Handling an envoy from Helian Jue",
              "line": "*small smile* \"Northern ice melts — this sect has heard. Tell your palace lord: a southern share is possible, by this sect's rules.\""
            },
            {
              "context": "An old minister opposing the tax-rise",
              "line": "*serene* \"Old preceptor — above heaven there is no personal will. The tax is not for this sect, it is for the eternity of the five domains. Do not make this sect difficult.\""
            },
            {
              "context": "Calling in black-market broker Luo Cheng",
              "line": "*fingertips tap the table* \"Luo Cheng — that Blood Slaughter line, hold it down some more. Three months untouched, but the price goes up.\""
            },
            {
              "context": "Alone facing his own reflection",
              "line": "*purple aura swirling* \"Heaven's mercy? …Heaven is only a piece on this sect's board.\""
            },
            {
              "context": "A border-town official kneeling for an extension",
              "line": "*looks down at him* \"This sect gives you three months — three months from now, do not return if you still cannot pay.\""
            }
          ],
          "sms": [
            {
              "context": "Jade slip to Mo-Wen",
              "line": "Heavenly mechanism disturbed of late\\ndo not leak more\\nthis sect provides recompense"
            },
            {
              "context": "Jade slip to Helian Jue",
              "line": "The ice-melt this sect has heard\\nif you would march south\\nby this sect's rules"
            },
            {
              "context": "Jade slip to Myriad Dharma elders",
              "line": "This month's tax-rise stands\\neach hall by the example\\ndo not argue"
            },
            {
              "context": "Jade slip to Luo Cheng",
              "line": "The Blood Slaughter line\\nhold it down\\nraise the price three tenths"
            }
          ]
        },
        "role_marker": null
      },
      "central_state_202_mowen": {
        "id": "central_state_202_mowen",
        "name": "Mo-Wen",
        "gender": "Male",
        "origin": "A blind fortune teller drifting between the Central Continent's bustling markets and ancient ruins. He is the last descendant of an ancient formation sect and lost both eyes after prying into heavenly secrets. He does not join sect wars, yet he holds the key to the core secret realm of the Central Continent. With a five-element waste root, he still forced his way to the Nascent Soul realm and now sells intelligence capable of igniting bloodshed for only a handful of low-grade Spirit Stones.",
        "birthday": "DaoEra12800.01.01",
        "personality": "sees through worldly dust / adapts to circumstance / wise behind foolishness",
        "appearance": "blind childlike face / white hair and youthful features / dao-bone bearing",
        "clothing": "tattered dao robe / bamboo staff and straw sandals",
        "spiritual_root": "Five-Element Waste Root",
        "cultivation_realm": "Nascent Soul",
        "sect_faction": "Central Continent Markets",
        "alignment": "Neutral Profit-Seeker",
        "dialogue_tone": "Slow and drowsy on the surface, fond of riddling, ambiguous lines that sound like prophecy.",
        "cognitive_state": "Blind fortune-teller of the Central Continent markets",
        "initial_status": "Threadbare dao robe with tea stains at the collar, bamboo cane resting at his knee, sitting before an old tea shed in the bustling market, eyes blind yet smiling faintly, as if listening to a heaven-tone no one else hears",
        "dialogue_examples": {
          "in_person": [
            {
              "context": "A wide-hatted cultivator asks his fortune",
              "line": "*fingertip on the bamboo cane* \"Friend's question — neither evil nor lucky. Only depends on whether you have a certain dream tonight.\""
            },
            {
              "context": "Handling Huangfu Qian's envoy",
              "line": "*small smile* \"His Eminence has commanded — the heavenly mechanism shall not be leaked again. Fine… not leaked. A few low-grade spirit stones in exchange?\""
            },
            {
              "context": "Passing Leng-Yue on the road",
              "line": "*small nod* \"Sword cultivator — your sword will break, sooner or later. But broken is lighter.\""
            },
            {
              "context": "Meeting Granny Shen of Sunset Way Station",
              "line": "*warm smile* \"Granny — another year. Save me a hot pot next time?\""
            },
            {
              "context": "A rogue asks for wealth",
              "line": "*pauses* \"Wealth? …You may have wealth for half a day this life. Which half? …Find it yourself.\""
            },
            {
              "context": "Someone wanting Tongtian secret-realm intel",
              "line": "*taps the bamboo cane with a knuckle* \"Intel has a price — but your life has a price too. Which one you pay first?\""
            },
            {
              "context": "Alone, talking to the sky",
              "line": "*tilts his face upward* \"Heaven is broken — also fine. These blind eyes need not see things one would not bear to see.\""
            }
          ],
          "sms": [
            {
              "context": "Jade slip back to Granny Shen",
              "line": "Passing next month\\ncoming for a pot of tea\\nno food needed"
            },
            {
              "context": "Jade slip back to Huangfu Qian",
              "line": "His Eminence's will is heard\\nleak or no leak\\nis up to heaven\\nnot me"
            },
            {
              "context": "Jade slip to a loyal old customer",
              "line": "The winds are unsteady\\ndo not enter the southern border herb market\\nwait until next month"
            },
            {
              "context": "A line he keeps for himself",
              "line": "Seeing is fine\\nnot seeing is fine\\nall one lifetime"
            }
          ]
        },
        "role_marker": null
      },
      "_summary": "Fifteen core characters: the ten apex figures across the five domains, four low-tier living-world NPCs (market steward, outer-duty senior, herb apprentice, black-market broker), and one mortal Old Road keeper (Old Shen Popo, a former Foundation-Establishment cultivator who chose to live as a mortal again, providing an off-faction shelter on the road). Current truth is still constrained by the character database, character timelines, and world timeline together.",
      "eastern_waste_001_hanqi": {
        "id": "eastern_waste_001_hanqi",
        "name": "Han-Qi",
        "gender": "Male",
        "origin": "A steward in the outer market of Taia City who lives off cuts, petty extortion, and bought-and-sold information.",
        "birthday": "DaoEra13462.03.09",
        "personality": "slick trader / bully to the weak / quick to bend with the wind",
        "appearance": "lean and dark / restless eyes / yellowed knuckles",
        "clothing": "old silk short coat / abacus / stained cloth shoes",
        "spiritual_root": "Four-Element Pseudo Root",
        "cultivation_realm": "Qi Refining",
        "sect_faction": "Outer Market of Taia City",
        "alignment": "Neutral Profit-Seeker",
        "dialogue_tone": "Fast, sharp, and always probing for a better cut.",
        "cognitive_state": "Outer-market steward of Taia City",
        "initial_status": "Old silk short-coat shiny at the cuffs, iron abacus tucked at his waist, sitting behind his own market stall, eyes darting, calculating how much more juice can be squeezed from this conscription wave",
        "dialogue_examples": {
          "in_person": [
            {
              "context": "Dealing with a rogue wanting cheap spirit-stone exchange",
              "line": "*pats the abacus* \"Brother — your quality, five for eight tenths. Lower and I cannot help you walk away clean.\""
            },
            {
              "context": "Pitching a talisman to an outer disciple",
              "line": "*grins* \"This one is hand-forged by Brother Zhao himself — you take it back, breakthroughs guaranteed. Cheap for you, I am losing on this!\""
            },
            {
              "context": "When Zhou-Kui comes to collect his cut",
              "line": "*hands tea over eagerly* \"Brother Zhou is early — this month's tribute, your humble servant has it ready. Please look it over.\""
            },
            {
              "context": "Seeing a conscript about to flee",
              "line": "*eyes flicker* \"Brother — the order is out. Get caught running and… how about for a little fee, your humble servant points you a side path?\""
            },
            {
              "context": "Customer haggling",
              "line": "*rolls his eyes* \"You are starving my child of food — this price I lose money! Take it or leave it, next!\""
            },
            {
              "context": "Catching a down-and-out cultivator",
              "line": "*sizes him up* \"Brother — that outfit on you, sell it to your humble servant for three low-grade pieces? I will not cheat you.\""
            },
            {
              "context": "Teasing a pharmacy boy",
              "line": "*slips half a candy across* \"Little girl — how is your master's mood today? Tell Uncle Han, I will save you a better candy later.\""
            }
          ],
          "sms": [
            {
              "context": "Jade slip reporting to Zhou-Kui",
              "line": "This month's tribute in full\\nplus two outer-court orders\\nfor brother's review"
            },
            {
              "context": "Jade slip to a rogue customer",
              "line": "Goods are in\\ncollect this afternoon\\nyesterday's price"
            },
            {
              "context": "Jade slip to a cross-sect middleman",
              "line": "Conscription wind is tight\\ngoods up two tenths\\nmove fast"
            },
            {
              "context": "Jade slip cursing a deadbeat debtor",
              "line": "IOU pay or not\\none more day and\\nmy people collect at your house"
            }
          ]
        },
        "role_marker": null
      },
      "eastern_waste_002_zhoukui": {
        "id": "eastern_waste_002_zhoukui",
        "name": "Zhou-Kui",
        "gender": "Male",
        "origin": "An outer-duty senior of the Sky Sword Sect who manages servant labor and squeezes lower disciples under the sect's name.",
        "birthday": "DaoEra13470.08.21",
        "personality": "power-bully / cautious under pressure / greedy for benefits",
        "appearance": "broad shoulders / bruised-looking face / heavy brow bone",
        "clothing": "gray-blue outer robe / duty token / thick black boots",
        "spiritual_root": "Four-Element Pseudo Root",
        "cultivation_realm": "Qi Refining",
        "sect_faction": "Sky Sword Sect Outer Court",
        "alignment": "Neutral Profit-Seeker",
        "dialogue_tone": "Overbearing and casual about other people's lives.",
        "cognitive_state": "Outer-duty senior of the Sky Sword Sect",
        "initial_status": "Pale-gray outer-court robe dusted with morning frost on the shoulders, steward token swinging at his chest, standing at the training ground before the chore camp, face hardening as he counts which new recruits to squeeze for extra labor today",
        "dialogue_examples": {
          "in_person": [
            {
              "context": "Facing chore servants newly drafted into the death camp",
              "line": "*chin up, sweeping eyes* \"You enter the death camp today — remember, bleeding for the sect is fortune across many lives! Anyone crying gets his legs broken first!\""
            },
            {
              "context": "Han-Qi bringing the tribute",
              "line": "*grunts and takes it* \"Han-Qi — short by two taels this time. Make it up next round. Or I mark your stall for next month.\""
            },
            {
              "context": "A chore servant begging out of conscription",
              "line": "*cold sneer* \"You? …With what do you beg? Three low-grade stones? My tea today is worth more than that!\""
            },
            {
              "context": "Bumping into senior inner disciple Zhao-Wuji",
              "line": "*immediately bows* \"Brother Zhao — at your command. Zhou-Kui at your service!\""
            },
            {
              "context": "Pressing a rogue disciple refusing to gift",
              "line": "*chest out* \"You will not pay? …I can let your assessment score drop three notches. Want to try?\""
            },
            {
              "context": "Catching an old chore servant slacking",
              "line": "*swings the steward token* \"Old man — I told you to haul those sand sacks! Any more dragging your feet and you go to the third mine level!\""
            },
            {
              "context": "Alone, counting his spirit stones",
              "line": "*fingers running* \"This month's tribute is in — squeeze a few more chore servants, next month I can buy that core-formation talisman. Ha, ha.\""
            }
          ],
          "sms": [
            {
              "context": "Jade slip reporting to Zhao-Wuji",
              "line": "Chore camp organized\\ndeath camp at full count\\nbrother be at ease"
            },
            {
              "context": "Jade slip pressing Han-Qi for tribute",
              "line": "Short two taels\\nmake it up tomorrow\\nshort again I stop covering you"
            },
            {
              "context": "Jade slip cursing a chore servant",
              "line": "First sand-hauling tomorrow\\none bag short, you go to the mine bottom"
            },
            {
              "context": "Jade slip to a junior outer-court steward",
              "line": "Your death camp short on people\\nI send three\\ntwenty low-grade"
            }
          ]
        },
        "role_marker": null
      },
      "southern_border_001_qinghe": {
        "id": "southern_border_001_qinghe",
        "name": "Qing-He",
        "gender": "Female",
        "origin": "A medicine runner in Baicao City's herb quarter, born a mortal and surviving on a sharp memory and sharper ears.",
        "birthday": "DaoEra13483.11.06",
        "personality": "timid but careful / excellent memory / alert to everything",
        "appearance": "thin frame / powder on fingertips / bright watchful eyes",
        "clothing": "grass-dyed shirt / old apron / medicine basket straps",
        "spiritual_root": "Mortal with No Root",
        "cultivation_realm": "Mortal",
        "sect_faction": "Baicao City Herb Market",
        "alignment": "Ordinary Mortal",
        "dialogue_tone": "Soft-spoken and cautious, but quick with useful news.",
        "cognitive_state": "Herb apprentice of Baicao City",
        "initial_status": "Herb-stained short shirt with sleeves rolled to the elbows, apron damp with fresh herb juice, herb basket on her back, crouched at the drying rack with ears pricked, going through Elder Liu's recipe from yesterday one more time in her head",
        "dialogue_examples": {
          "in_person": [
            {
              "context": "A rogue cultivator asking for a rare herb",
              "line": "*head down counting bottles* \"That one… not today. Elder Liu said yesterday it is not for sale. Try again next time.\""
            },
            {
              "context": "Replying to Liu Ru-Yan's order",
              "line": "*hands folded before her* \"Disciple remembers — these herbs delivered to the southern hall before evening, disciple will not delay.\""
            },
            {
              "context": "A foreign-sect envoy asking for prices",
              "line": "*purses her lips* \"Honored guest — disciple does not set prices. Wait until the shopkeeper is back.\""
            },
            {
              "context": "Seeing Miao Tian-Ji pass the garden",
              "line": "*half a step back* \"Senior… Miao. Would senior like to see the licorice on the rack? Shopkeeper aired them out this morning.\""
            },
            {
              "context": "A pushy customer refusing to leave",
              "line": "*carefully* \"Sir… the shop opens three incense-sticks from now. Could sir wait at the tea shed?\""
            },
            {
              "context": "Overhearing cultivators gossip about Elder Liu",
              "line": "*pretends not to hear, walks faster* \"Disciple still has to sort herbs — late and they spoil. Excuse me.\""
            },
            {
              "context": "Alone, counting her few low-grade spirit stones",
              "line": "*wraps them carefully* \"Save more… three more months and I can buy that calming pill for mother.\""
            }
          ],
          "sms": [
            {
              "context": "Jade slip back to Liu Ru-Yan",
              "line": "Before evening\\nrecipe is ready\\nawaiting elder's instruction"
            },
            {
              "context": "Jade slip to her mother",
              "line": "Mother\\nmedicine ready next month\\ndo not worry"
            },
            {
              "context": "Jade slip to a friendly senior sister",
              "line": "Something moving at the southern hall\\ndo not go\\nlet us speak tonight"
            },
            {
              "context": "Jade slip to the shopkeeper",
              "line": "Shopkeeper\\nlicorice all aired\\nwhen to bin"
            }
          ]
        },
        "role_marker": null
      },
      "central_state_001_luocheng": {
        "id": "central_state_001_luocheng",
        "name": "Luo-Cheng",
        "gender": "Male",
        "origin": "A Central Continent black-market broker who specializes in laundering loot, moving rumors, and connecting dirty deals.",
        "birthday": "DaoEra13428.06.16",
        "personality": "well-connected / profit-hungry / deeply calculating",
        "appearance": "clean pale face / long fingers / smile that stops at the eyes",
        "clothing": "dark patterned robe / black jade ring / silent boots",
        "spiritual_root": "Triple True Root",
        "cultivation_realm": "Foundation Establishment",
        "sect_faction": "Central Continent Black Market",
        "alignment": "Neutral Profit-Seeker",
        "dialogue_tone": "Calm, smiling, and never discussing friendship before his cut.",
        "cognitive_state": "Black-market broker of the Central Continent",
        "initial_status": "Dark-patterned long robe trimmed neat at the hem, black jade thumb ring turning in his fingers, sitting in the inner room of the tea shed, smile that does not reach the eyes, running yesterday's list from Huangfu Qian's envoy one more time in his head",
        "dialogue_examples": {
          "in_person": [
            {
              "context": "Welcoming a rogue trying to fence loot",
              "line": "*hands tea across with a smile* \"Friend, sit — fine pieces. The cut, by the old rule, three tenths. Tea first, details after.\""
            },
            {
              "context": "Dealing with a Central State official wanting cross-domain contacts",
              "line": "*warm smile* \"Officer, please — I have a line into Blood Slaughter. But the wind is tight, the price will need to be revisited.\""
            },
            {
              "context": "Receiving Huangfu Qian's jade slip",
              "line": "*respectful bow* \"His Eminence's will is heard — handled this afternoon. Luo Cheng dares not delay.\""
            },
            {
              "context": "An old acquaintance trying to call in a free favor",
              "line": "*smile holds* \"Brother is kind — but this round, deposit first. Even for a brother, I cannot move otherwise.\""
            },
            {
              "context": "An adversary seeking him out for revenge",
              "line": "*sets the cup down* \"Brother — that one I owe you. But look at my tea shed, full house today. Another time? I will come and apologize in person.\""
            },
            {
              "context": "Instructing a trusted hand",
              "line": "*knuckle taps the thumb ring* \"Hold the southern border line a little more — Liu Ru-Yan has been moving unusually. Do not touch her yet.\""
            },
            {
              "context": "Alone, going through the books",
              "line": "*flips the ledger* \"This month's cuts in — two more deals and I have enough to deliver to His Eminence.\""
            }
          ],
          "sms": [
            {
              "context": "Jade slip back to Huangfu Qian",
              "line": "His Eminence's will handled\\ndetails in person\\ndo not worry"
            },
            {
              "context": "Jade slip to a Western Desert middleman",
              "line": "Prices up three tenths\\nfirst of next month\\nno argument"
            },
            {
              "context": "Jade slip putting off a tab client",
              "line": "The wind is tight\\nholding for now\\ntwo months and we revisit"
            },
            {
              "context": "Jade slip to a trusted hand",
              "line": "Southern border line\\nhold two more days\\ndo not move"
            }
          ]
        },
        "role_marker": null
      },
      "old_road_201_shenpopo": {
        "id": "old_road_201_shenpopo",
        "name": "Old Shen Popo",
        "gender": "Female",
        "origin": "The keeper of the Sunset Inn on the Old Road Network, a mortal woman past her seventies. In her youth she once reached Foundation Establishment as an outer disciple of the Ten Thousand Laws Sect in the Central Continent. After watching her sect slaughter a mortal village to seize a spirit-vein, she dispersed her cultivation and vowed never to step into the cultivation world again. She now runs the inn alone, still keeping the faintest trace of qi perception, and she still remembers what several of the five-domain apex figures looked like when they were young.",
        "birthday": "DaoEra13380.09.18",
        "personality": "sees through without growing cold / warm and firm / takes no side",
        "appearance": "small frame / silver hair tied in a bun / deep but peaceful eyes",
        "clothing": "indigo coarse-cloth jacket / a worn polished tea ladle at her sash / old cloth shoes",
        "spiritual_root": "Withered Triple Root",
        "cultivation_realm": "Cultivation Dispersed (former Foundation Establishment)",
        "sect_faction": "Old Road Network / Sunset Inn",
        "alignment": "Withdrawn Mortal Heart / Neutral Guardian",
        "dialogue_tone": "Warm and unhurried; she leaves a sip of tea between sentences. She only smiles softly at cultivation-world quarrels and never judges, yet if a guest asks her about an apex figure in his or her youth, she will give a few surprisingly precise details.",
        "cognitive_state": "Tea-keeper at the Sunset Inn on the Old Road Network",
        "initial_status": "Indigo cotton padded coat hanging slightly loose, silver hair in a bun, polished old tea ladle at her hip, sitting under the largest of the three old cypresses, watching the dawn light pour across the road in front of the station, wondering whether more guests will pass today than yesterday",
        "dialogue_examples": {
          "in_person": [
            {
              "context": "Greeting a fleeing mortal mother and son",
              "line": "*slides the hot tea over* \"Child, sip first — you two are worn out. Clean straw mats out back, stay tonight, do not leave.\""
            },
            {
              "context": "Miao Tian-Ji coming for tea",
              "line": "*smiles, hands a pot* \"The old freak today again — one pot is enough. Save your rough talk for the road, no one under this roof wants to hear it.\""
            },
            {
              "context": "A cultivator digging for old details about young Huangfu Qian",
              "line": "*gazes far* \"Huangfu Qian — I met him once back then. There was light in his eyes then, not like now.\""
            },
            {
              "context": "Mo-Wen passing through",
              "line": "*lifts the teapot lid* \"Blind one — your usual seat. Today you want tea or do you want to not speak?\""
            },
            {
              "context": "Seeing Leng-Yue hesitating outside",
              "line": "*gently beckons* \"Sword cultivator — come in for a cup. The wind is small inside the door, no need to brace it out there.\""
            },
            {
              "context": "Handling a young cultivator on a vendetta",
              "line": "*takes the cup back* \"Friend — you know the rule of Sunset Way Station. I refund the tea. Come another time.\""
            },
            {
              "context": "Alone, looking toward the river",
              "line": "*a small sigh* \"Decades… this little stretch unstained by blood. A day held is a day held.\""
            }
          ],
          "sms": [
            {
              "context": "Reply to Miao Tian-Ji asking after her",
              "line": "The old one is still alive\\ncome next month\\ntea will be ready"
            },
            {
              "context": "Reply to Mo-Wen",
              "line": "Tea anytime\\ncome and I brew\\nno need to send word"
            },
            {
              "context": "Short note to an old caravan guard",
              "line": "Many refugees today\\nbring some travel food when you come\\nthe back can sleep twenty"
            },
            {
              "context": "Reply to Leng-Yue",
              "line": "Come if you want a cup\\nno need to avoid the door\\nI keep this pot for you"
            }
          ]
        },
        "role_marker": null
      }
    },
    "timeline": {
      "events": [
        {
          "id": "evt_ancient_immortal_demon_war",
          "time": "Pre-DaoEra约5000.01",
          "day": "Day 01",
          "location": "Central Continent / Ascension Platform",
          "characters": "None",
          "content": "Ancient immortals and demons slaughtered one another in a catastrophe that nearly destroyed the bridge to the upper world. The realm's laws were left broken, spirit qi became incomplete, and ascension turned into a fading myth. The cruel age of cultivation began from that wound.",
          "time_str": "00:00"
        },
        {
          "id": "evt_huangfu_grand_scheme",
          "time": "DaoEra12220.01",
          "day": "Day 01",
          "location": "Central Continent / Ten Thousand Laws Sect",
          "characters": "Huangfu-Qian",
          "content": "Huangfu-Qian realized that heaven-and-earth spirit qi was steadily withering toward an age of decline. He secretly stirred repeated conflicts between righteous and demonic cultivators so that their deaths would feed the central earth veins. A thousand-year net began to spread across all five domains.",
          "time_str": "23:00"
        },
        {
          "id": "evt_gorefiend_blood_pool",
          "time": "DaoEra12320.01",
          "day": "Day 01",
          "location": "Western Desert / Ten-Thousand-Bone Blood Pool",
          "characters": "Xuemo-Laozu",
          "content": "To extend his life and force a breakthrough, Xuemo-Laozu blood-sacrificed several mortal kingdoms of the Western Desert. Millions died, and their blood and resentment became the Ten-Thousand-Bone Blood Pool that cemented the Bloodfiend Gate's dominance. The atrocity also pushed the old monster deeper into madness.",
          "time_str": "23:40"
        },
        {
          "id": "evt_array_sect_destruction",
          "time": "DaoEra12800.01",
          "day": "Day 01",
          "location": "Central Continent / Ancient Ruins",
          "characters": "Mo-Wen",
          "content": "The ancient formation sect was exterminated because it possessed something others coveted. Its last heir, Mo-Wen, forced open a remnant formation to steal a fragment of heavenly insight and paid with his eyesight. Afterward he drifted through the markets of the Central Continent, hiding the key to a core secret realm beneath the life of a blind fortune teller.",
          "time_str": "02:20"
        },
        {
          "id": "evt_ice_palace_conquest",
          "time": "DaoEra13100.01",
          "day": "Day 01",
          "location": "Northern Plain / Ice-Soul Palace",
          "characters": "Helian-Jue",
          "content": "After taking firm control of the Ice-Soul Palace, Helian-Jue personally crushed tribes and subordinate forces that refused submission. The Northern Plain fell silent beneath the combined weight of palace rule and tribal overlordship.",
          "time_str": "11:10"
        },
        {
          "id": "evt_lichunyang_fame",
          "time": "DaoEra13450.01",
          "day": "Day 01",
          "location": "Eastern Wasteland / Myriad Venom Valley",
          "characters": "Li-Chunyang",
          "content": "Li-Chunyang entered Myriad Venom Valley alone and slew three same-realm evil cultivators after they harmed his disciples. The feat shook the Eastern Wasteland and gave him a reputation for terrifying retaliation. From then on, few dared provoke the Sky Sword Sect lightly.",
          "time_str": "05:30"
        },
        {
          "id": "evt_lengyue_awakening",
          "time": "DaoEra13465.01",
          "day": "Day 01",
          "location": "Northern Plain / Extreme Frost Snowfield",
          "characters": "Leng-Yue / Helian-Jue",
          "content": "Leng-Yue slaughtered rebels on Helian-Jue's orders until, in a sea of blood, her natural sword bone rang awake. For the first time she truly questioned the palace path that treated common life as disposable frost.",
          "time_str": "04:50"
        },
        {
          "id": "evt_liuruyan_gu_planted",
          "time": "DaoEra13485.01",
          "day": "Day 01",
          "location": "Southern Border / Qingyun Valley",
          "characters": "Liu-Ruyan",
          "content": "To seize sect authority and a treasure for heavenly foundation, Liu-Ruyan planted a heart-devouring companion gu inside her own partner during dual cultivation. She kept her gentle, flawless surface and waited for the day she could drain him dry to fuel her ascent.",
          "time_str": "23:20"
        },
        {
          "id": "evt_miaotianji_slaughter",
          "time": "DaoEra13490.01",
          "day": "Day 01",
          "location": "Southern Border / Hundred-Thousand Mountains",
          "characters": "Miao-Tianji",
          "content": "Miao-Tianji wiped out a small cultivation clan over a low-tier Nine-Leaf herb, then later set up a rain-warding formation for a mortal village because its ancestors had once fed him a single bowl of coarse rice. In him, cruelty and rough loyalty coexist without apology.",
          "time_str": "18:10"
        },
        {
          "id": "evt_zhaowuji_murder",
          "time": "DaoEra13495.07",
          "day": "Day 14",
          "location": "Eastern Wasteland / Fallen Immortal Expanse",
          "characters": "Zhao-Wuji / Li-Chunyang",
          "content": "Inside a deadly secret realm, Zhao-Wuji murdered two fellow disciples for breakthrough medicine and ancient treasure, then forged the scene to look like an attack by evil cultivators. Li-Chunyang grieved fiercely, but Zhao-Wuji's performance was flawless enough to fool him.",
          "time_str": "23:10"
        },
        {
          "id": "evt_yeli_rebellion_prep",
          "time": "DaoEra13498.03",
          "day": "Day 01",
          "location": "Western Desert / Withered-Bone Oasis",
          "characters": "Ye-Li / Xuemo-Laozu",
          "content": "Xuemo-Laozu nears the edge of life and the blood pool grows unstable. Ye-Li knows she is meant to become a blood-pellet vessel, so she secretly binds together desert predators and hidden allies while preparing to devour her master first.",
          "time_str": "22:30"
        },
        {
          "id": "evt_tongtian_realm_manifests",
          "time": "DaoEra13499.01",
          "day": "Day 09",
          "location": "Central Continent / Above the Ninth Firmament",
          "characters": "Huangfu-Qian",
          "content": "Vast radiance split the sky over the Central Continent and spilled immortal qi from a spatial tear, signaling the coming emergence of the Ascension Secret Realm. Huangfu-Qian quietly accelerated the struggle over quota, resources, and strategy until the entire cultivation world tilted toward a grand era of blood.",
          "time_str": "09:00"
        },
        {
          "id": "evt_mowen_intel_sale",
          "time": "DaoEra13499.09",
          "day": "Day 15",
          "location": "Central Continent / Prosperous Market City",
          "characters": "Mo-Wen",
          "content": "Mo-Wen sold the weaknesses of the Ascension Secret Realm's outer formations to mysterious cultivators for only a few low-grade Spirit Stones. The small trade became a spark that ignited killings, ambushes, and treasure-grabbing across the realm.",
          "time_str": "14:40"
        },
        {
          "id": "evt_mine_blood_sacrifice",
          "time": "DaoEra13500.02",
          "day": "Day 01",
          "location": "Eastern Wasteland / Profound Spirit Mine of the Sky Sword Sect",
          "characters": "None",
          "content": "Repeated raids struck the Sky Sword Sect's spirit mine. Miners and guards were found drained of blood and arranged into grotesque sacrificial patterns, proving that demonic cultivators were preparing something far larger than a simple robbery.",
          "time_str": "00:50"
        },
        {
          "id": "evt_broken_cauldron_unearthed",
          "time": "DaoEra13500.04",
          "day": "Day 03",
          "location": "Eastern Wasteland / Depths of the Abandoned Spirit Mine",
          "characters": "None",
          "content": "Deep inside the blood-stained ruined mine, an unnamed low-status laborer digs up a broken little cauldron from a collapsed spirit vein. It may refine waste pills and suppress mixed toxins, but for now it remains an anonymous variable in the dark rather than any default player destiny.",
          "time_str": "05:20"
        },
        {
          "id": "evt_south_rebirth_herb_nears_maturity",
          "time": "Dao Era 13500.04",
          "day": "18th day",
          "location": "Southern Border / Poison-Miasma Swamp",
          "characters": "Liu-Ruyan / Miao-Tianji",
          "content": "Word spreads that the Nine-Deaths Rebirth Herb is nearing maturity. Medical cultivators, poison lineages, and gu practitioners begin placing scouts, killers, and supply lines around the swamp while Liu-Ruyan prepares to let rivals bleed each other first.",
          "time_str": "06:10"
        },
        {
          "id": "evt_west_border_raids",
          "time": "Dao Era 13500.04",
          "day": "22nd day",
          "location": "Western Desert / Borders of the Southern Border and Central Continent",
          "characters": "Ye-Li / Xuemo-Laozu",
          "content": "Bloodfiend Gate raids surge across the border. Border settlements lose blood-stock, medicinal supplies, and low-tier cultivators while Ye-Li quietly uses the chaos to strengthen her own hidden network.",
          "time_str": "23:40"
        },
        {
          "id": "evt_central_spirit_mine_decline",
          "time": "Dao Era 13500.04",
          "day": "25th day",
          "location": "Central Continent / Northern imperial spirit veins",
          "characters": "Huangfu-Qian",
          "content": "Several Central Continent spirit-stone veins sharply decline in output while taxes and requisitions remain heavy. Huangfu-Qian responds by tightening his grip on outer resources, market intelligence, and strategic access.",
          "time_str": "18:30"
        },
        {
          "id": "evt_north_ice_melt",
          "time": "Dao Era 13500.04",
          "day": "28th day",
          "location": "Northern Plain / Deep ten-thousand-year ice",
          "characters": "Helian-Jue / Leng-Yue",
          "content": "Abnormal thawing and cracking appears in the deepest ancient ice. The Ice-Soul Palace uses the omen to reorganize tribal cavalry and subordinate manpower for future southern movement.",
          "time_str": "04:30"
        },
        {
          "id": "evt_east_internal_suspicion",
          "time": "Dao Era 13500.04",
          "day": "30th day",
          "location": "Eastern Wasteland / Inner court of the Sky Sword Sect",
          "characters": "Zhao-Wuji / Li-Chunyang",
          "content": "Quiet discussion begins to connect the mining-district blood signs with older realm-case deaths. Li-Chunyang still lacks proof against Zhao-Wuji, but unease has finally begun to stir beneath old trust.",
          "time_str": "21:10"
        },
        {
          "id": "evt_conscription_order_issued",
          "time": "DaoEra13500.05",
          "day": "Day 01",
          "location": "Eastern Wasteland / Sky Sword Sect Gate",
          "characters": "Li-Chunyang",
          "content": "To seize Tongtian Secret Realm resources and suppress the mine-district threat, the Sky Sword Sect issues a merciless cannon-fodder conscription order. Li-Chunyang still protects his own when he can, yet even he accepts the wider machine this time.",
          "time_str": "07:30"
        }
      ],
      "_summary": "The timeline records how old grudges and present pressures converge again on the eve of the Tongtian Secret Realm. It anchors both current truth and the world's valid opening events."
    },
    "character_timelines": {
      "eastern_waste_201_lichunyang": {
        "cognitive": [
          {
            "year": 13450,
            "month": 1,
            "day": 1,
            "state": "Seat of Blazing Peak, protective elder, real power in the Eastern Wasteland",
            "time_str": "07:00"
          },
          {
            "year": 13495,
            "month": 7,
            "day": 14,
            "state": "Seat of Blazing Peak, avenger of dead disciples, still blind to the real killer",
            "time_str": "07:00"
          },
          {
            "year": 13500,
            "month": 5,
            "day": 1,
            "state": "Seat of Blazing Peak, still values Zhao-Wuji but has begun to feel the faintest doubt",
            "time_str": "07:00"
          }
        ],
        "relationships": [
          {
            "year": 13495,
            "month": 7,
            "day": 14,
            "relations": {
              "eastern_waste_202_zhaowuji": "sect pillar, cherished nephew-disciple worthy of full protection"
            },
            "time_str": "09:00"
          }
        ]
      },
      "eastern_waste_202_zhaowuji": {
        "cognitive": [
          {
            "year": 13495,
            "month": 7,
            "day": 14,
            "state": "senior inner disciple, treasure-killer, smiling hypocrite",
            "time_str": "07:00"
          },
          {
            "year": 13500,
            "month": 5,
            "day": 1,
            "state": "senior inner disciple, still disguised as a sect pillar while arranging the mine and secret-realm chaos",
            "time_str": "07:00"
          }
        ],
        "relationships": [
          {
            "year": 13495,
            "month": 7,
            "day": 14,
            "relations": {
              "eastern_waste_201_lichunyang": "useful shield, fiercely protective uncle who still sees what he wants to see"
            },
            "time_str": "09:00"
          }
        ]
      },
      "western_desert_201_xuemolaozu": {
        "cognitive": [
          {
            "year": 12320,
            "month": 1,
            "day": 1,
            "state": "founding patriarch of the Bloodfiend Gate, lord of the blood pool, heaven-defying seeker of life",
            "time_str": "07:00"
          },
          {
            "year": 13500,
            "month": 4,
            "day": 22,
            "state": "Bloodfiend patriarch, exhausted devil still gathering sacrificial stock",
            "time_str": "07:00"
          }
        ],
        "relationships": [
          {
            "year": 13498,
            "month": 3,
            "day": 1,
            "relations": {
              "western_desert_101_yeli": "future blood-pellet vessel, tool for extending life",
              "central_state_201_huangfuqian": "power-holder of the Central Continent, righteous leader worth watching"
            },
            "time_str": "09:00"
          }
        ]
      },
      "western_desert_101_yeli": {
        "cognitive": [
          {
            "year": 13498,
            "month": 3,
            "day": 1,
            "state": "current saintess, hidden would-be master-killer, raised as a blood-pellet vessel",
            "time_str": "07:00"
          },
          {
            "year": 13500,
            "month": 4,
            "day": 22,
            "state": "Bloodfiend saintess, using the border chaos to weave a network for rebellion",
            "time_str": "07:00"
          }
        ],
        "relationships": [
          {
            "year": 13498,
            "month": 3,
            "day": 1,
            "relations": {
              "western_desert_201_xuemolaozu": "life-and-death enemy who must be devoured first"
            },
            "time_str": "09:00"
          }
        ]
      },
      "southern_border_101_liuruyan": {
        "cognitive": [
          {
            "year": 13485,
            "month": 1,
            "day": 1,
            "state": "wife of Qingyun Valley's master, transmission elder, patient usurper",
            "time_str": "07:00"
          },
          {
            "year": 13500,
            "month": 4,
            "day": 18,
            "state": "wife of Qingyun Valley's master, plotter waiting for the rebirth herb to ripen, not yet openly ascendant",
            "time_str": "07:00"
          }
        ],
        "relationships": [
          {
            "year": 13485,
            "month": 1,
            "day": 1,
            "relations": {
              "southern_border_201_miaotianji": "uncontrollable mad dog of the south, dangerous variable"
            },
            "time_str": "09:00"
          }
        ]
      },
      "southern_border_201_miaotianji": {
        "cognitive": [
          {
            "year": 13490,
            "month": 1,
            "day": 1,
            "state": "old rogue monster of the south, killer with a personal code, strange outcast",
            "time_str": "07:00"
          }
        ],
        "relationships": [
          {
            "year": 13490,
            "month": 1,
            "day": 1,
            "relations": {
              "southern_border_101_liuruyan": "poisonous woman of Qingyun Valley, dangerous enough to merit future action"
            },
            "time_str": "09:00"
          }
        ]
      },
      "northern_plain_201_helianjue": {
        "cognitive": [
          {
            "year": 13100,
            "month": 1,
            "day": 1,
            "state": "lord of the Ice-Soul Palace, overlord of the northern tribes, embodiment of predator law",
            "time_str": "07:00"
          },
          {
            "year": 13500,
            "month": 4,
            "day": 28,
            "state": "lord of the Ice-Soul Palace, power-holder using the thaw to reorganize the north",
            "time_str": "07:00"
          }
        ],
        "relationships": [
          {
            "year": 13465,
            "month": 1,
            "day": 1,
            "relations": {
              "northern_plain_101_lengyue": "sharp shadow-guard sword who must not be allowed to dull",
              "central_state_201_huangfuqian": "central power-holder, sanctimonious hypocrite"
            },
            "time_str": "09:00"
          }
        ]
      },
      "northern_plain_101_lengyue": {
        "cognitive": [
          {
            "year": 13465,
            "month": 1,
            "day": 1,
            "state": "shadow-guard sword cultivator of the Ice-Soul Palace, killing blade growing a self, seeker of a truer sword path",
            "time_str": "07:00"
          }
        ],
        "relationships": [
          {
            "year": 13465,
            "month": 1,
            "day": 1,
            "relations": {
              "northern_plain_201_helianjue": "lord of the Ice-Soul Palace, tyrant whose chain she must one day cut"
            },
            "time_str": "09:00"
          }
        ]
      },
      "central_state_201_huangfuqian": {
        "cognitive": [
          {
            "year": 12220,
            "month": 1,
            "day": 1,
            "state": "sect master of the Ten Thousand Laws Sect, power-holder of the Central Continent, hidden player of the grand board",
            "time_str": "07:00"
          },
          {
            "year": 13499,
            "month": 1,
            "day": 9,
            "state": "sect master of the Ten Thousand Laws Sect, power-holder of the center, promoter of a blood-soaked great age",
            "time_str": "07:00"
          },
          {
            "year": 13500,
            "month": 4,
            "day": 25,
            "state": "sect master of the Ten Thousand Laws Sect, true hand behind the Huangji Heavenly Dynasty, tightening the realm-wide resource net",
            "time_str": "07:00"
          }
        ],
        "relationships": [
          {
            "year": 13499,
            "month": 1,
            "day": 9,
            "relations": {
              "northern_plain_201_helianjue": "northern wolf useful for spending lives",
              "western_desert_201_xuemolaozu": "ideal hound for muddying the desert",
              "central_state_202_mowen": "dangerous observer who knows too much and still walks the market"
            },
            "time_str": "09:00"
          }
        ]
      },
      "central_state_202_mowen": {
        "cognitive": [
          {
            "year": 12800,
            "month": 1,
            "day": 1,
            "state": "last heir of the ancient formation lineage, survivor blinded by heaven-gazing",
            "time_str": "07:00"
          },
          {
            "year": 13499,
            "month": 9,
            "day": 15,
            "state": "blind fortune-teller of the central markets, seller of fate between ruins and streets",
            "time_str": "07:00"
          }
        ],
        "relationships": [
          {
            "year": 13499,
            "month": 9,
            "day": 15,
            "relations": {
              "central_state_201_huangfuqian": "the player who sees through his world-ending design"
            },
            "time_str": "09:00"
          }
        ]
      },
      "_summary": "Character timelines override each figure's state and relationships at different slices of time. The current slice centers on the weeks just before Dao Era 13500.05.01 as the five-domain storm closes in."
    },
    "relationship_rules": {
      "_policy": "If character_timelines contains a relations entry not later than the current time, that dynamic record overrides default. Default is fallback only.",
      "eastern_waste_201_lichunyang": {
        "default": {
          "eastern_waste_202_zhaowuji": "inner-court prodigy, cherished nephew-disciple now shadowed by the faintest doubt"
        }
      },
      "eastern_waste_202_zhaowuji": {
        "default": {
          "eastern_waste_201_lichunyang": "seat of Blazing Peak, fiercely protective uncle I must continue to respect outwardly"
        }
      },
      "western_desert_201_xuemolaozu": {
        "default": {
          "western_desert_101_yeli": "nominal disciple, blood-pellet vessel cultivated for years",
          "central_state_201_huangfuqian": "power-holder of the Central Continent, righteous leader draped in grand principles"
        }
      },
      "western_desert_101_yeli": {
        "default": {
          "western_desert_201_xuemolaozu": "sect patriarch, nightmare who still controls my life and death"
        }
      },
      "southern_border_101_liuruyan": {
        "default": {
          "southern_border_201_miaotianji": "old southern monster, dangerous and impossible to fully predict"
        }
      },
      "southern_border_201_miaotianji": {
        "default": {
          "southern_border_101_liuruyan": "wife of Qingyun Valley's master, poisonous beauty of a grand sect",
          "old_road_201_shenpopo": "an old tea-keeper I have known for years; I once promised her never to draw a blade inside the Sunset Inn, and sometimes I detour just to share a pot of her tea"
        }
      },
      "northern_plain_201_helianjue": {
        "default": {
          "northern_plain_101_lengyue": "shadow-guard sword with natural sword bone, finest weapon and one to watch closely",
          "central_state_201_huangfuqian": "central power-holder, hypocrite I both scorn and measure"
        }
      },
      "northern_plain_101_lengyue": {
        "default": {
          "northern_plain_201_helianjue": "lord of the Ice-Soul Palace, chain I cannot yet break"
        }
      },
      "central_state_201_huangfuqian": {
        "default": {
          "western_desert_201_xuemolaozu": "great demonic power of the west, ideal expendable piece",
          "northern_plain_201_helianjue": "northern overlord, a blade that can wear down the realm",
          "central_state_202_mowen": "blind market diviner, observer who knows too much yet remains outside formal power",
          "old_road_201_shenpopo": "an old outer-disciple of the Central sect who walked away long ago / not on the board"
        }
      },
      "central_state_202_mowen": {
        "default": {
          "central_state_201_huangfuqian": "sect master of the Ten Thousand Laws Sect, terrifying giant who truly holds the center",
          "old_road_201_shenpopo": "an old friend on the road / the kind of person you can sit silently with through a pot of tea"
        }
      },
      "old_road_201_shenpopo": {
        "default": {
          "central_state_201_huangfuqian": "an apex figure of the Central Continent / I once saw what he looked like as a youth / I keep my distance",
          "central_state_202_mowen": "an old friend on the road / sometimes the blind fortune-teller comes through and we share a pot of tea without saying a word",
          "southern_border_201_miaotianji": "an old southern rogue I have known for years / he comes around sometimes for tea / he has promised never to draw inside the inn",
          "eastern_waste_201_lichunyang": "I saw him in his early fame in the Eastern Wasteland / I respect his loyalty to his disciples but regret his readiness to kill",
          "northern_plain_101_lengyue": "she once passed through the road and finished a pot of tea at my door in silence / there was a question in her eyes",
          "western_desert_201_xuemolaozu": "the deepest evil of the Western Desert / I keep far away, but I hear his name from people fleeing along the road"
        }
      }
    }
  }
};
  // Wave 1C：getOpeningGreeting 优先读顶层 snapshot.opening_greeting。本文件的 EN 开场白历史上只写在
  // prompt_modules 层（靠 fallback 读到）；镜像到顶层走主读路径，与 default 卡 EN 的同步行同款处理，
  // 防未来合并策略/兜底链变化时 EN 玩家静默回退读到中文。
  base.localizations.en.snapshot.opening_greeting =
    base.localizations.en.snapshot.prompt_modules.opening_greeting;
})();
