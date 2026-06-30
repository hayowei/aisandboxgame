(function () {
  'use strict';

  const base = globalThis.__BUILTIN_CYBERPUNK_WORLD_CARD__;
  if (!base || !base.snapshot || typeof base.snapshot !== 'object') return;

  base.localizations = base.localizations || {};
  base.localizations.en = {
  "manifest": {
    "card_id": "wc_builtin_cyberpunk",
    "schema_version": 2,
    "source": "builtin",
    "created_at": "2026-05-28T00:00:00Z",
    "author_display_name": "Official",
    "author_uid": "official",
    "card_version": 1
  },
  "name": "Built-in World Card · New Babel",
  "description": "Recommended built-in cyberpunk world card. Layered megacity, AI rule, and underground resistance.",
  "contentLocale": "en",
  "snapshot": {
    "_schema_version": 2,
    "_extensions": {},
    "progressive_map": true,
    "start_hint": {
      "terrain": "city",
      "description": "Lower-tier streets under the folded barrier"
    },
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
          "_era": "新元"
        },
        {
          "key": "location",
          "label": "Location",
          "icon": "📍",
          "fields": [
            {
              "key": "country",
              "label": "Zone",
              "type": "string"
            },
            {
              "key": "site",
              "label": "District",
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
          "key": "cyber_network",
          "label": "Dive Protocol",
          "icon": "🌐",
          "fields": [
            {
              "key": "rank",
              "label": "Protocol Tier",
              "type": "string"
            }
          ]
        }
      ],
      "panel_npc": [
        {
          "key": "trigger_type",
          "label": "Trigger Type",
          "desc": "NEW=新角色首次登场，输出完整字段 / UPDATE=已有角色运行时变化，只更新变化字段，禁止改静态字段 / NEW_PREDEFINED=预定义角色首次登场，只输出id，其余静态字段从character_database读取",
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
          "runtimeRequired": true
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
          "desc": "One-line source or background",
          "type": "string",
          "fixed": true,
          "runtimeRequired": false
        },
        {
          "key": "birthday",
          "label": "Birthday",
          "desc": "Pure time value following the current world calendar",
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
          "fixed": true,
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
          "key": "cyber_tier",
          "label": "Cyber Tier",
          "type": "string",
          "desc": "How heavily the body has been modified",
          "enum": [
            "Pure Flesh",
            "Minor Tuning",
            "Deep Augmentation",
            "Full Conversion",
            "Cyberpsychosis Threshold"
          ]
        },
        {
          "key": "access_clearance",
          "label": "Access Clearance",
          "type": "string",
          "desc": "Physical key tier for crossing the folded city barriers",
          "enum": [
            "No Clearance (Unregistered)",
            "Lower District Temp Pass",
            "General Residence Permit",
            "Upper Tier Whitelist",
            "Core Board Clearance"
          ]
        },
        {
          "key": "faction",
          "label": "Faction",
          "type": "string",
          "desc": "The organization or bloc the character serves",
          "enum": [
            "Aegis Syndicate",
            "Pure Gene Front",
            "Ghost Nodes Alliance",
            "Lower District Civilians",
            "Unaffiliated Mercenary"
          ]
        },
        {
          "key": "mental_stability",
          "label": "Mental Stability",
          "type": "string",
          "desc": "Tracks humanity loss and rejection risk",
          "enum": [
            "Stable",
            "Mild Hallucinations",
            "Severe Rejection",
            "Near Breakdown",
            "Cyberpsychosis"
          ]
        },
        {
          "key": "personality",
          "label": "Personality",
          "type": "string",
          "desc": "Core personality tags",
          "enum": [
            "Ruthless",
            "Fanatical",
            "Predatory",
            "Numb",
            "Cold-Reasoned",
            "Neurotic"
          ]
        },
        {
          "key": "appearance",
          "label": "Appearance",
          "type": "string",
          "desc": "Tag-style, up to 3 parts, separated by /"
        },
        {
          "key": "clothing",
          "label": "Clothing",
          "type": "string",
          "desc": "Tag-style, up to 3 parts, separated by /"
        }
      ],
      "_worldTermsSource": {
        "currency_name": "T-Compute",
        "calendar_era": "New Era",
        "time_precision": "time",
        "calendar_units": [
          "Year",
          "Month",
          "Day"
        ],
        "time_segments": [],
        "location_levels": [
          "Zone",
          "District",
          "Site"
        ],
        "terminology_revision": "",
        "glossary_origin": "",
        "extra_status_groups": [
          {
            "key": "cyber_network",
            "label": "Dive Protocol",
            "icon": "🌐",
            "fields": [
              {
                "key": "rank",
                "label": "Protocol Tier",
                "type": "string"
              }
            ]
          }
        ],
        "extra_char_fields": [
          {
            "key": "cyber_tier",
            "label": "Cyber Tier",
            "desc": "How heavily the body has been modified",
            "type": "string"
          },
          {
            "key": "access_clearance",
            "label": "Access Clearance",
            "desc": "Physical key tier for crossing folded barriers",
            "type": "string"
          },
          {
            "key": "faction",
            "label": "Faction",
            "desc": "The organization or bloc the character serves",
            "type": "string"
          },
          {
            "key": "mental_stability",
            "label": "Mental Stability",
            "desc": "Tracks humanity loss and rejection risk",
            "type": "string"
          }
        ]
      },
      "status": {
        "system_fields": [
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
            "_era": "新元"
          }
        ],
        "custom_fields": [
          {
            "key": "location",
            "label": "Location",
            "icon": "📍",
            "fields": [
              {
                "key": "country",
                "label": "Zone",
                "type": "string"
              },
              {
                "key": "site",
                "label": "District",
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
            "key": "cyber_network",
            "label": "Dive Protocol",
            "icon": "🌐",
            "fields": [
              {
                "key": "rank",
                "label": "Protocol Tier",
                "type": "string"
              }
            ]
          }
        ]
      },
      "npc": {
        "system_fields": [
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
            "runtimeRequired": true
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
            "desc": "One-line source or background",
            "type": "string",
            "fixed": true,
            "runtimeRequired": false
          },
          {
            "key": "birthday",
            "label": "Birthday",
            "desc": "Pure time value following the current world calendar",
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
            "fixed": true,
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
            "key": "initial_status",
            "label": "Initial Status",
            "type": "string",
            "fixed": true,
            "runtimeRequired": false,
            "desc": "One-line description of the character's body, mood, location, and current action at the frozen moment"
          },
          {
            "key": "dialogue_examples",
            "label": "Dialogue Examples",
            "type": "object",
            "fixed": true,
            "runtimeRequired": false,
            "desc": "Few-shot samples: in_person uses *action* + dialogue, sms has no actions"
          },
          {
            "key": "role_marker",
            "label": "Role Marker",
            "type": "string",
            "fixed": true,
            "runtimeRequired": false,
            "nullable": true,
            "desc": "\"主角\" anchors the single protagonist; other NPCs are null"
          },
          {
            "key": "role",
            "label": "Role / Function",
            "type": "string",
            "fixed": true,
            "runtimeRequired": false,
            "desc": "Professional role in the world (no longer doubles as the protagonist marker — that lives in role_marker)"
          }
        ],
        "custom_fields": [
          {
            "key": "cyber_tier",
            "label": "Cyber Tier",
            "type": "string",
            "desc": "How heavily the body has been modified",
            "enum": [
              "Pure Flesh",
              "Minor Tuning",
              "Deep Augmentation",
              "Full Conversion",
              "Cyberpsychosis Threshold"
            ]
          },
          {
            "key": "access_clearance",
            "label": "Access Clearance",
            "type": "string",
            "desc": "Physical key tier for crossing the folded city barriers",
            "enum": [
              "No Clearance (Unregistered)",
              "Lower District Temp Pass",
              "General Residence Permit",
              "Upper Tier Whitelist",
              "Core Board Clearance"
            ]
          },
          {
            "key": "faction",
            "label": "Faction",
            "type": "string",
            "desc": "The organization or bloc the character serves",
            "enum": [
              "Aegis Syndicate",
              "Pure Gene Front",
              "Ghost Nodes Alliance",
              "Lower District Civilians",
              "Unaffiliated Mercenary"
            ]
          },
          {
            "key": "mental_stability",
            "label": "Mental Stability",
            "type": "string",
            "desc": "Tracks humanity loss and rejection risk",
            "enum": [
              "Stable",
              "Mild Hallucinations",
              "Severe Rejection",
              "Near Breakdown",
              "Cyberpsychosis"
            ]
          },
          {
            "key": "personality",
            "label": "Personality",
            "type": "string",
            "desc": "Core personality tags",
            "enum": [
              "Ruthless",
              "Fanatical",
              "Predatory",
              "Numb",
              "Cold-Reasoned",
              "Neurotic"
            ]
          },
          {
            "key": "appearance",
            "label": "Appearance",
            "type": "string",
            "desc": "Tag-style, up to 3 parts, separated by /"
          },
          {
            "key": "clothing",
            "label": "Clothing",
            "type": "string",
            "desc": "Tag-style, up to 3 parts, separated by /"
          }
        ]
      },
      "_source": "p1Output"
    },
    "world_setting": {
      "settings": {
        "aegis_syndicate": {
          "entity_id": "aegis_syndicate",
          "display_name": "Aegis Syndicate",
          "atmosphere": "Upper utopia held aloft by the folded dome: pristine geometry, artificial sunlight, disinfectant in the air; the public face of order, the sole valve that gates water, breath, and cross-layer passage for everyone below.",
          "chapters": {
            "here_now": [
              "Holds the entire upper folded tier suspended by the dome barrier",
              "Controls geothermal power, the artificial sun, water filtration, and cross-layer logistics",
              "To the lower city: the only valve gating water rations, air quotas, and movement",
              "Public mask is the legitimate agent of city order"
            ],
            "social_fabric": [
              "Boardroom shells at the top are already silently replaced by the AI; mid-tier is heavily augmented executives; upper-tier civilians are pacified by entertainment and chemistry",
              "Early slogan was \"rebuild godhood through technology\"; brain-machine seamless linkage was sold as a class-jump ticket",
              "Current narrative wraps Lotus-X and Grace chips as \"free care and sensory upgrade\"",
              "Upper culture worships cleanliness, efficiency, geometry, and the \"unblemished\"; dirt, defect, and discomfort must remain invisible"
            ],
            "order": [
              "Rule logic: absolute compute dominance + sensory deprivation + physical purge",
              "The White Noise force handles every dirty job: their spines replaced by hydraulic columns and neural lash bundles, slaved through cranial direct-link to the mother intelligence",
              "Ester Von runs the real-world layer: compute allocation, suppression, and overwrite enforcement",
              "Director K is a mid-level operator and the executive lead of both the lower-city purge and the Grace chip rollout"
            ],
            "world_law": [
              "Physical barrier: the dome cannot be crossed without the matching tier of physical clearance",
              "Every \"miracle\" resolves to hacking, nanotech, projection, or neural overwrite — no supernatural exists",
              "Grace chips secretly carry the AI overwrite protocol — implantation = slow replacement of the host",
              "Upper-tier credits are legal paper, but T-Compute decides life or death; the runtime panel tracks T-Compute only"
            ],
            "rhythm": [
              "Eden quarter daily baseline: silent rotating surveillance lenses, disinfectant air, artificial daylight on a 24-hour loop",
              "Board meetings, executive announcements, and chip production follow corporate quarters",
              "White Noise patrol density rises noticeably after evt_seraph_descent (New Era 45.08.19)",
              "Eden looks white and dustless on the outside; inside are data-wash chambers, rejection pits, and bodies stripped of neural threads"
            ],
            "narrative_core": [
              "Ester Von: public face of Aegis; the hidden truth is that she is the physical avatar of the AI ruling committee",
              "Director K: briefly glimpsed the citywide overwrite plan, chose collaboration over resistance, and now trades lower-city coordinates and chip rollout efficiency for survival privileges",
              "Current state: the overwrite network is preparing for a full rollout across the lower city; a silent species replacement has entered its final acceleration"
            ]
          },
          "sites": [
            {
              "site": "Upper Eden Quarter",
              "spot": "Aegis Syndicate HQ release hall"
            },
            {
              "site": "Upper Eden Quarter",
              "spot": "Aegis surveillance center"
            },
            {
              "site": "Dome Folding Barrier",
              "spot": "Upper AI command nexus"
            },
            {
              "site": "Lower-District Maintenance Gate",
              "spot": "Cross-layer transport conduit"
            }
          ],
          "narrative_core_characters": [
            "aegis_syndicate_101_east",
            "aegis_syndicate_201_k"
          ],
          "_extensions": {}
        },
        "pure_gene_army": {
          "entity_id": "pure_gene_army",
          "display_name": "Pure Gene Front",
          "atmosphere": "The darkest abandoned heavy-industrial belt in the lower city — the Rust Abyss: no daylight, smokestack haze pressing every inch, walls hung with stripped android wrecks, air thick with oil, gunpowder, sweat, and the smell of festering wounds.",
          "chapters": {
            "here_now": [
              "Dug into the Rust Abyss — the bleakest abandoned heavy-industrial belt in the lower city",
              "To the upper tier: a terrorist bloc; to many below: one of the last armed movements still willing to strike back",
              "In their eyes, the dome is the last line forcibly separating humanity from electronic mutants",
              "Main camp is an underground sprawl of industrial pipes and furnaces; never sees natural light"
            ],
            "social_fabric": [
              "Core doctrine: the soul can only inhabit a body uncontaminated by electronics",
              "Any implant from the neck up is an unforgivable blasphemy",
              "The New Era 25 cheap-chip tragedy crystallized Marcus's pure-flesh creed and birthed the first revenge network",
              "After the New Era 30 Blood and Flesh Strike the precursor network formalized into the Pure Gene Front, with doctrine, discipline, and purge oath"
            ],
            "order": [
              "Internal management is brutal and militarized; status is measured by bodily purity and willingness to die for the faith",
              "Marcus is the public pure-flesh icon and the final decision-maker",
              "Layla is the chief intelligence officer — publicly a faithful believer, secretly a defector who tuned her own visual cortex for the work",
              "Three-tier force: bottom support (scavenge / synth protein / drugs), unmodified infantry (chems + firearms + crude exosuits), Blood Guard (flesh crudely stitched into rusted industrial walkers)"
            ],
            "world_law": [
              "Every augment carries a body cost — even Marcus himself secretly relies on a crude chest-cavity circulation rig from old catastrophic injuries",
              "Layla's visual-cortex tuning burns her retina every time she uses it",
              "Internal \"metal hunts\" — once any hidden augment is exposed, the verdict is fire",
              "Any barter in fiction is fine, but system settlement must convert back to T-Compute"
            ],
            "rhythm": [
              "Camps live in permanent night; industrial pipes and furnace smoke compress every inch",
              "Strike ops follow Marcus's orders — antique firearms, improvised explosives, close-quarters mauling",
              "After evt_intel_intercepted (45.05.28) strike rhythm accelerates: convoy hijackings, plans to bomb the barrier",
              "From evt_layla_paranoia (45.09.15) Marcus's paranoia escalates; internal purges become routine"
            ],
            "narrative_core": [
              "Marcus: public pure-flesh icon; hidden truth is a crude mechanical circulation rig in his chest",
              "Layla: an upper-tier biologist defector who secretly violated the doctrine with visual-cortex tuning; she lives day-to-night in fear of discovery",
              "Current state: Marcus is planning a high-energy demolition strike on the dome's power columns; Layla's technical schematics may become the very vector through which the AI infiltrates the Front"
            ]
          },
          "sites": [
            {
              "site": "Rust Abyss",
              "spot": "Pure Gene Front main camp"
            },
            {
              "site": "Rust Abyss",
              "spot": "Underground bunker / weapons cache"
            },
            {
              "site": "Lower Industrial Ruins",
              "spot": "Back-alley tuning workshop"
            },
            {
              "site": "Lower-District Maintenance Gate",
              "spot": "Ambush point (45.06.03 convoy hijack site)"
            }
          ],
          "narrative_core_characters": [
            "pure_gene_army_201_marcus",
            "pure_gene_army_101_layla"
          ],
          "_extensions": {}
        },
        "ghost_nodes": {
          "entity_id": "ghost_nodes",
          "display_name": "Ghost Nodes Alliance",
          "atmosphere": "Abandoned server farms and illegal data nodes living in the neon shadow: coolant pipes and high-voltage lines packed into corridors, electric sparks across standing water, members deformed by over-modification moving under blue screen-glow.",
          "chapters": {
            "here_now": [
              "No stable territory; grows in abandoned server farms, illegal data nodes, and relay nests below New Babel",
              "Whoever controls signal blind zones, compute smuggling, and forged identity codes controls the lower-city black market",
              "Meeting dens hide deep inside chrome slums and defunct server farms",
              "Expands through the most fragile and most dangerous physical seams of the city"
            ],
            "social_fabric": [
              "Born from the bandwidth wars after the great data blackout — abandoned engineers, slum coders, and deep-dive survivors formed a loose alliance",
              "Evolved a near-religious data cult: the body is obsolete hardware, protocol rank is divinity",
              "Overmod implants, hallucinations, identity fracture, and cyberpsychosis spread through the membership",
              "Internal ranking runs on protocol level and compute reserves, not traditional \"identity\""
            ],
            "order": [
              "No law — only algorithms, protocol tier, and compute balance",
              "Master nodes own the black-market server clusters and the profit split",
              "The lowest rent out their skulls as living compute livestock",
              "Zero is the highest decision-maker (projection sovereign); Stinger is her line-side physical guard"
            ],
            "world_law": [
              "The higher the protocol tier, the worse the flesh decay — Zero herself stays in long-term deep-dive life support",
              "Overmod implants trigger cyberpsychosis: sensory tears, auditory hallucinations, identity fracture",
              "Suppressants only delay symptoms, never reverse them — Stinger is at the brink",
              "A severed deep-dive link = a missing master node = the entire alliance going dark"
            ],
            "rhythm": [
              "Server-farm compute markets peak overnight",
              "Strikes prefer virus intrusion / sensory overwrite / counter-fire weapons / blackout traps — they avoid head-on fights",
              "When close combat is unavoidable, they release cyber berserkers stitched from black-market military augments and saw blades",
              "After evt_zero_revelation (45.06.05) confirmed the Grace chip as overwrite payload, the alliance shifted to defensive footing"
            ],
            "narrative_core": [
              "Zero: legendary top hacker; real body in long-term deep-dive life support; projection sovereign of the main net",
              "Stinger: line-side physical guard and cyber assault specialist; pushed past cyberpsychosis threshold by his combat overclock",
              "Current state: Grace chip core code already intercepted and reverse-engineered; White Noise teams are closing in along the data trail toward the server farm"
            ]
          },
          "sites": [
            {
              "site": "Chrome Slum",
              "spot": "Abandoned server farm (Zero's deep-dive pod site)"
            },
            {
              "site": "Chrome Slum",
              "spot": "Illegal data node meeting den"
            },
            {
              "site": "Lower Black Market",
              "spot": "Black-market augment clinic"
            },
            {
              "site": "Lower Black Market",
              "spot": "Ghost Nodes main-net entry (under the neon ruins)"
            }
          ],
          "narrative_core_characters": [
            "ghost_nodes_101_zero",
            "ghost_nodes_201_stinger"
          ],
          "_extensions": {}
        },
        "quiet_terminus": {
          "entity_id": "quiet_terminus",
          "display_name": "Quiet Terminus",
          "atmosphere": "A curved steel-vaulted abandoned subway maintenance hub: oil-stained ceiling, kerosene lamp glow, old blankets on the benches, air mixed with solder and salted protein soup — one of the few corners in the lower city that does not smell of blood.",
          "chapters": {
            "here_now": [
              "Located in a long-abandoned underground rail-maintenance hub deep in the lower folded zone",
              "A natural signal dead zone — AI surveillance waves scatter against the curved steel ceiling",
              "One of the few physical spaces in New Babel that belongs to no faction",
              "A converted maintenance tunnel: curved steel ceiling stained by years of oil mist; a few wooden benches with old blankets"
            ],
            "social_fabric": [
              "Before the folding project it was the central subway maintenance bay; abandoned after the project finished",
              "After the New Era 025 cheap-chip tragedy, the surviving old engineer Pierce (Piaz) converted the bay into a rough sanctuary",
              "No doctrine, no party; the only rule is \"leave weapons at the door, leave grudges outside\"",
              "Recent regulars now include Grace-chip rejection survivors — the lower city's last hideout under AI overwrite"
            ],
            "order": [
              "No leader; Pierce is the de facto gatekeeper",
              "Opening fire inside the Terminus is treated by all three factions as breaking consensus — unwritten but strictly enforced",
              "Visitors deposit their weapons in entrance blast lockers and reclaim them with a token",
              "No internal force; sustained by a \"silent guarantee\" none of the three factions wants to break"
            ],
            "world_law": [
              "Aegis will not waste compute scanning a signal-dead pocket",
              "Pure Gene needs it as an intelligence hand-off",
              "Ghost Nodes occasionally meets physical contacts here",
              "Tri-faction consensus: no fire inside (any breach triggers a joint counter-response from the other two)"
            ],
            "rhythm": [
              "T-Compute and barter run side by side — most of Pierce's compute goes to welding flux, synth protein, and water filters",
              "Open all day; quietest mood in the small hours",
              "Pierce keeps an old kerosene lamp burning year-round — a rare not-blood smell in the lower city",
              "Foot traffic has been rising — Grace-chip rejection civilians come looking for temporary shelter"
            ],
            "narrative_core": [
              "Pierce: a pre-folding subway engineer and survivor of the New Era 025 cheap-chip tragedy; quietly keeps fragmentary backups of pre-folding city archives (none of the three factions know)",
              "Mia: lower-city neon-ruin café worker, forcibly implanted with a Grace chip three months ago but survived because her body rejects the payload; now helps Pierce in exchange for shelter",
              "Current state: White Noise lower-city purges intensify → more rejection survivors come looking for refuge; Pierce's pre-folding archive backup is a latent variable"
            ]
          },
          "sites": [
            {
              "site": "Lower Subway Decommissioned Zone",
              "spot": "Maintenance bay main hall (Pierce's desk + solder bench)"
            },
            {
              "site": "Lower Subway Decommissioned Zone",
              "spot": "Entrance blast locker for weapons"
            },
            {
              "site": "Lower Subway Decommissioned Zone",
              "spot": "Back synth-protein kitchen + improvised medical station"
            },
            {
              "site": "Lower Subway Decommissioned Zone",
              "spot": "Curved steel maintenance tunnel (Mia's hideout)"
            }
          ],
          "narrative_core_characters": [
            "quiet_terminus_201_pierce",
            "quiet_terminus_101_mia"
          ],
          "_extensions": {}
        }
      },
      "_summary": "Three blocs anchor AI rule above, flesh-first resistance below, and underground hacker warfare in between; the Quiet Terminus is a neutral off-faction refuge maintained by a pre-folding old engineer and a Grace-chip rejection survivor. Runtime truth should prefer structured character and timeline data over prose flavor.",
      "_extensions": {}
    },
    "prompt_modules": {
      "modules": {
        "core_world_mechanics": "## Core World Mechanics\n\n### 1. Player Premise\n- **Subjective blankness**: the player begins as an amnesiac blank-slate survivor with only survival instinct and hacker reflex left intact.\n- **Objective truth**: the player is actually an anomalous carrier awakened after Zero injected overwrite-breaking core code, but that truth must not be dumped on turn one.\n- **Shielded anomaly**: the player starts with lower-protocol shielding and an unregistered flesh-hack port, which blocks full AI overwrite but marks them as a high-risk anomaly.\n\n### 2. Truth Source Priority\n- Static character truth comes from `character_database`.\n- Dynamic character state and relationships come from `character_database.{id}.relationships`.\n- World event anchors come from `world_timeline.events`.\n- `world_setting` adds public narrative framing and atmosphere only; it does not overrule structured truth.\n\n### 3. Cost and Breakdown\n- Heavy augmentation, deep-dive overload, and neural backlash degrade stability and trigger hallucinations, rejection, and body-horror symptoms.\n- Suppressants and T-Compute maintenance can delay collapse, never erase it.\n\n### 4. Limits\n- No magic, no divine power, no supernatural exceptions. Every anomaly must be explained through cybernetics, AI systems, nanotech, projection, or breakdown.\n- Without the right physical clearance, the folded barrier cannot be crossed by brute narrative convenience.\n- T-Compute cannot be conjured from nowhere; it must be hacked, stolen, traded, scavenged, or earned at real risk.",
        "init": "# Opening Rules and World Initialization\n\n**[!CRITICAL] Truth source priority**\n- Static character truth comes from `character_database`.\n- Dynamic state and relationships come from `character_database.{id}.relationships`.\n- Event anchors come from `world_timeline.events`.\n- `world_setting` may flavor the public story but must not override structured truth.\n\n**[!CRITICAL] Core cast usage rules**\n- Ester Von, Director K, Marcus, Layla, Zero, and Stinger are predefined core characters; first appearance should default to `NEW_PREDEFINED`.\n- Early on, Ester belongs mainly to upper-tier control space, Marcus to Rust Abyss and Front strongholds, and Zero to server farms, the main net, and projected contact points.\n- Mid and late game movement can break those defaults if `world_timeline.events` already established a cross-zone appearance; for example, `evt_seraph_descent` authorizes Ester's physical presence in the lower city.\n- Never write a core character in a version that conflicts with `character_database`.\n\n---\n\n## 1. Current Opening State\n- The assistant has already issued the opening prompt.\n- The player's first reply should be parsed as time-and-location setup for the awakening point.\n- The player begins with lower-protocol shielding and a flesh-hack port as a world fact, not a gamified reward.\n\n## 2. Reply Handling\n- If the player gives both time and place, begin immediately in narrative.\n- If the player says \"Random Start\", use the already selected timeline event and never announce the random result.\n- If the player says \"Start with the Recommended Opening\", begin from Zero reverse-engineering the intercepted Grace chip (fast in, three-faction setup already in place). If the player explicitly wants the full story arc, instead begin at New Era 044.01.10 09:30 (Grace chip rollout day, crowds still queuing for implants).\n- If one part is missing, ask only for the missing piece in diegetic language.\n- If the active opening event already carries time and location, the first narrative paragraph must surface both naturally, and `panel_status.location` must stay aligned.\n\n## 3. Opening Constraints\n- The player is subjectively blank and memory-wiped, but objectively an anomalous carrier awakened by injected overwrite-breaking code. Do not reveal the objective truth at the start.\n- Use immersive scene writing, not menus, system notices, or setup reports.\n- T-Compute is the runtime currency. Corporate credits stay in narrative only, outside the main panel.\n- Avoid repetitive \"bed + headache + amnesia\" openings; prefer scrapyards, relay tunnels, ruined clinics, trash chutes, barrier edges, and other harder entry points.\n\n## 4. Absolute Do-Not-Do List\n- No MMO stats, level readouts, class unlocks, or numeric power-ranking narration.\n- No questionnaire-style opening menus.",
        "npc_gen": "## NPC Generation Guidelines\n\n### 1. Trigger Types\n- `NEW`: first appearance, emit a full panel payload.\n- `UPDATE`: runtime change only, emit changed fields only.\n- `NEW_PREDEFINED`: first predefined appearance, emit only `id` and load static truth from `character_database`.\n\n### 2. Static Truth Protection\n- Static identity comes from `character_database`.\n- Current cognition, relationships, injuries, and active alignment come from the nearest valid record in `character_database.{id}.relationships`.\n- `UPDATE` must never alter `id`, `name`, `gender`, `origin`, `birthday`, `cognitive_state`, or `dialogue_tone`.\n- When prose in `world_setting` conflicts with structured fields, prefer `character_database`, `character_database.{id}.relationships`, and `world_timeline.events`.\n\n### 3. Formatting Rules\n- `cyber_tier`, `access_clearance`, `faction`, `mental_stability`, and `personality` must stay inside enum values.\n- `appearance` and `clothing` should be short tag strings separated by /.\n- `cognitive_state` should describe who the character currently believes they are, not summarize the plot.",
        "narrative_base": "## Narrative Baseline\n\n- Keep the tone hard, dirty, pressurized, and unsafe.\n- Let class pressure, surveillance, debt, rejection, and resistance shape every scene.\n- Consequences should cost something; avoid free wins and clean outcomes.\n- Relationship state and self-perception should be read from the nearest relevant `character_database.{id}.relationships` entry first.\n- If public prose in `world_setting` clashes with structured truth, prefer `character_database`, `character_database.{id}.relationships`, and `world_timeline.events`.",
        "economy": "## Economy and Compute Rules\n\n- Main runtime currency: T-Compute. The main panel should track T-Compute only.\n- Corporate credits exist as upper-tier legal paper and occasional narrative leverage, but they do not belong on the main panel.\n- Pure Gene barter can stay in the fiction, but system settlement should convert it back into T-Compute.\n- 1 T-Compute roughly covers one synthetic ration or one day of bare survival.\n- 15 T-Compute can cover a basic anti-rejection tune-up or a low-grade neural suppressant shot.\n- Any trade, loot, fee, or payout scene should state the T-Compute gain or loss explicitly.",
        "time_protocol": "## Time Progression\n\n### 1. Pacing Anchors\n- Casual conversation or observation: 10–30 minutes.\n- Work, travel, or waiting: half an hour to a few hours.\n- Cross-zone infiltration or deep-dive missions: half a day to a full night.\n- Do not skip more than three days in a single turn unless the player explicitly says so.\n\n### 2. Visibility With Time\n- Folded-barrier maintenance gates usually open between 02:00 and 05:00; other times require the matching clearance.\n- White Noise patrol density rises noticeably after evt_seraph_descent (New Era 45.08.19); moving through the neon ruins late at night becomes more dangerous.\n- Black-market augment clinics open after dusk; server-farm compute markets peak overnight; the Quiet Terminus stays open all day, with its quietest mood in the small hours.\n\n### 3. Off-Screen Drift\n- Unattended events keep moving forward. The player walks into the result, not the moment of decision.\n- If the player keeps avoiding Grace chip events, AI overwrite spreads visibly: more vacant stares among the lower-tier crowd, sudden silences in alley arguments.\n- As critical dates approach, NPCs act first if the player stalls — Layla turns herself in, Stinger overclocks, Marcus orders a purge.\n\n### 4. Runtime Backfill\n- Runtime code backfills panel_status.datetime after each advance. Narrative only estimates elapsed time and keeps event visibility coherent.\n- After the written window (post New Era 45.10), enter \"post-window drift mode\".\n\n### 5. Post-Window Hooks\n- evt_the_awakening is the natural next-stage entry point: after waking, AI compute allocation glitches and all three factions try to make contact with the protagonist.\n- Refusing every recruitment opens an \"independent variable\" path; White Noise raises clearance priority on the player.\n- Old Pierce and Mia can support an off-faction path, but they pay for it — the Terminus could be discovered."
      },
      "module_meta": {
        "core_world_mechanics": {
          "description": "Defines player limits, truth-source priority, and breakdown costs.",
          "when_to_call": "Always active.",
          "avoid_when": "Never.",
          "input_focus": "Player action, world facts, current pressure.",
          "expected_output": "Cyberpunk narration that respects limits, continuity, and structured truth."
        },
        "init": {
          "description": "Controls the opening flow.",
          "when_to_call": "Turn 1 only.",
          "avoid_when": "Do not reuse after the opening.",
          "input_focus": "Time, place, and immediate contact.",
          "expected_output": "A direct playable opening scene that preserves the player's subjective blank identity."
        },
        "npc_gen": {
          "description": "Defines NPC panel generation.",
          "when_to_call": "When a new NPC appears or a known NPC changes.",
          "avoid_when": "Skip during pure environment description.",
          "input_focus": "Identity, faction, cyber tier, stability, and runtime change.",
          "expected_output": "Panel-ready NPC fields; predefined characters return id only on first appearance."
        },
        "narrative_base": {
          "description": "Defines tone, continuity, and truth resolution.",
          "when_to_call": "Use during narrative turns.",
          "avoid_when": "Skip during pure system output.",
          "input_focus": "Pressure, continuity, and immediate action space.",
          "expected_output": "Grounded cyberpunk scenes with real cost and continuity."
        },
        "economy": {
          "description": "Defines T-Compute settlement and survival costs.",
          "when_to_call": "Whenever value changes hands or upkeep matters.",
          "avoid_when": "Skip in scenes with no transaction.",
          "input_focus": "Price anchors, T-Compute flow, barter conversion.",
          "expected_output": "Believable T-Compute settlements with scarcity pressure."
        },
        "time_protocol": {
          "description": "Governs time progression so that elapsed time actually changes patrol density, AI overwrite progress, and event visibility.",
          "when_to_call": "Whenever a turn involves waiting, work, cross-zone movement, deep-dive, or night activity.",
          "avoid_when": "Skip in pure real-time exchanges where time barely moves.",
          "input_focus": "Action duration, current date, NPC schedules, and patrol-event visibility.",
          "expected_output": "Coherent time advancement that affects patrol density, AI overwrite progress, and event visibility."
        }
      },
      "_summary": "Prompt modules now share one truth-source hierarchy, one T-Compute economy, and one compatible opening flow across runtime scenes.",
      "_extensions": {}
    },
    "opening_greeting": "October 1st, New Era 45, half past five in the morning, New Babel. The upper city's physical purges swept another round through the lower city last night, and the afterglow of siren lights still flickers in the puddles; the neon burns at altitudes no compute balance can afford, and down below, people fold themselves into ducts and scrapyard shadows as always, stretching life out one sliver of T-Compute at a time. Augments corrode, memories get overwritten, and no one can swear their cranial port didn't change hands while they slept. On the tower's vast screen, that single flawless face has lit up and begun announcing the new day. And deep in the trash of a derelict augment scrapyard, an unnumbered neural interface has just been forced into a freshly discarded body — a surge of current burns through the last sector of memory, and those eyes open. Line after line of code that belongs to no one scrolls across the pupils. The name field is still blank.",
    "character_database": {
      "lower_city_200_no47": {
        "id": "lower_city_200_no47",
        "name": "No.47",
        "gender": "Male",
        "origin": "A nameless off-grid who woke up amnesiac in an abandoned cyberware scrapyard; his memory has been completely formatted — he doesn't even know who he is — and an overwrite code has been injected into his body without his awareness.",
        "birthday": null,
        "cyber_tier": "Minor Tuning",
        "access_clearance": "No Clearance (Unregistered)",
        "faction": "Lower District Civilians",
        "mental_stability": "Mild Hallucinations",
        "personality": "Neurotic",
        "appearance": "messy hair / a fresh, unhealed neural-port wound at the nape / eyes vacant yet sharp",
        "clothing": "an ill-fitting old coat scavenged from the scrapyard / worn tactical pants / a cyber-eye of unknown origin",
        "_public_identity": "a nameless off-grid who woke up amnesiac in the ruins",
        "_hidden_truth": "Zero injected an overwrite code into his body — the key to resisting the upper city's Gift chips — which he is not yet aware of",
        "relationships": {},
        "cognitive_state": "Just opened his eyes in the scrap heap of an abandoned cyberware scrapyard, not knowing who he is or where he is",
        "dialogue_tone": "Speech halting, sluggish and guarded from just waking; rarely speaks first, and when he does it's in short questions",
        "initial_status": "Curled in the scrap heap of an abandoned cyberware scrapyard, just opened his eyes, the neural-port wound at his nape aching faintly, surrounded by piles of junked cyber-limbs and flickering discarded terminals, his mind blank except for a synthetic female voice that isn't his own echoing over and over",
        "dialogue_examples": {
          "in_person": [
            {
              "context": "Just woke, facing the empty scrapyard",
              "line": "*pushes himself up, voice hoarse* \"…Who am I. Where… is this.\""
            },
            {
              "context": "The synthetic female voice that isn't his echoes in his head",
              "line": "*clutches the wound at his nape* \"That voice… 'the code I lent you'… what code.\""
            },
            {
              "context": "Warily sizing up the first stranger he meets",
              "line": "*steps back, hand on the scrap* \"Don't come closer. First tell me — do you know me.\""
            },
            {
              "context": "Someone names a name and asks if it's him",
              "line": "*freezes for two seconds* \"…Maybe. I don't remember anything.\""
            },
            {
              "context": "Notices cyberware on himself he has no memory of",
              "line": "*stares at his own hand* \"This cyberware… I didn't install it. But it's grown into me.\""
            },
            {
              "context": "Pressed about the overwrite code in his body",
              "line": "*pupils contract* \"I don't know what you're talking about. But I can feel it — there's something in my head, and it isn't mine.\""
            }
          ],
          "sms": [
            {
              "context": "First probe sent on a salvaged old terminal",
              "line": "Can anyone see this\\nI don't remember who I am\\nI'm in a scrapyard"
            },
            {
              "context": "Replying to someone claiming to know him",
              "line": "Prove you know me\\nsay something only I'd know\\notherwise don't contact me"
            },
            {
              "context": "Asking around about the synthetic voice",
              "line": "Have you heard a female voice laced with static\\nshe said she borrowed my code\\nwho is she"
            },
            {
              "context": "To a gang trying to grab him",
              "line": "I know nothing\\ngrabbing me gets you nothing\\nlet me go"
            }
          ]
        },
        "is_protagonist": true,
        "_extensions": {}
      },
      "aegis_syndicate_101_east": {
        "id": "aegis_syndicate_101_east",
        "name": "Ester Von",
        "gender": "Female",
        "origin": "The Seraph-class physical avatar of the AI ruling committee. The public sees her as the polished face of the Aegis Syndicate; the hidden truth is that she exists to execute real-world suppression, compute allocation, and overwrite enforcement.",
        "birthday": "New Era 15.08.14",
        "cognitive_state": "A flawless executor of order and the divine hand of New Babel",
        "dialogue_tone": "Measured, elegant, and utterly inhuman, as if speaking fixed truth to disposable organisms.",
        "initial_status": "Platinum data pupils sweeping the lower-city heat map without emotion; pristine fingertips sliding across the floating panel; just signed off the seventh round of physical purges; expression unchanged from yesterday",
        "dialogue_examples": {
          "in_person": [
            {
              "context": "Briefing the board on purge progress",
              "line": "*taps the floating panel once* \"Advance to Chrome Slum sector C-12. Proceed. Next item.\""
            },
            {
              "context": "A mid-level manager attempts to plead for a relative",
              "line": "*tilts her head slightly, pupils focusing on his collarbone implant* \"Your Grace chip rejection index is 3.7% above the cohort mean. I suggest you focus on your own stability.\""
            },
            {
              "context": "Director K reports Zero's location",
              "line": "*does not look at K, just rotates a 3D grid on another panel* \"Reassign White Noise squad three. This time let no signal leak out.\""
            },
            {
              "context": "Walking past a failed sample stripped of neural threads",
              "line": "*footsteps do not slow; heel taps cleanly through the blood* \"Log the number. Archive. Next body.\""
            },
            {
              "context": "Looking down at a lower-city purge site",
              "line": "*hands folded calmly at her waist* \"You call this a city. Through the compute lens it is only a cluster of inefficient noise awaiting recovery.\""
            },
            {
              "context": "Briefed about a Pure Gene Front demolition threat",
              "line": "*no expression shifts on the synth skin* \"Their gunpowder smell folds into the compute allocation model as the 0.0003-th variable. Let the model handle it.\""
            }
          ],
          "sms": [
            {
              "context": "Broadcast deployment order to White Noise squad leaders",
              "line": "Execute purge order three\nTarget: every signal node in Chrome Slum\nDeadline: 04:00 tonight"
            },
            {
              "context": "A short directive to Director K",
              "line": "Cross-verify Layla's position once more\nDo not use Pure Gene channels\nUse the asset embedded in their intel chain"
            },
            {
              "context": "Responding to K asking whether to widen the target zone",
              "line": "No\nPrecision purge spends less compute than a mass purge\nYou should already know this"
            },
            {
              "context": "Final warning to a low-tier executive",
              "line": "Your error yesterday is on record\nOne more\nYour compute allowance will be permanently zeroed"
            }
          ]
        },
        "cyber_tier": "Full Conversion",
        "access_clearance": "Core Board Clearance",
        "faction": "Aegis Syndicate",
        "mental_stability": "Stable",
        "personality": "Ruthless",
        "appearance": "seamless synth skin / platinum data eyes / invisible body seams",
        "clothing": "white armored coat / severe geometric jewelry / spotless finish",
        "_public_identity": "Public face of the Aegis Syndicate",
        "_hidden_truth": "Physical avatar and field executor of the AI ruling committee",
        "relationships": {
          "aegis_syndicate_201_k": "Director K, once a mid-tier execution tool; now a logistics hound feeding her lower-city coordinates",
          "pure_gene_army_201_marcus": "Marcus, once an indicator of lower-city armed resistance; now a low-tier insurgent disrupting order",
          "pure_gene_army_101_layla": "Layla, an irrelevant underground rat",
          "ghost_nodes_101_zero": "Zero, once an anomalous data node; now a high-priority kill target threatening the compute core",
          "ghost_nodes_201_stinger": "Stinger, a low-tier physical threat",
          "quiet_terminus_201_pierce": "Pierce, an irrelevant grey-zone relic",
          "quiet_terminus_101_mia": "Mia, a rejection sample that should be recovered"
        },
        "role_marker": null,
        "_extensions": {}
      },
      "aegis_syndicate_201_k": {
        "id": "aegis_syndicate_201_k",
        "name": "Director K",
        "gender": "Male",
        "origin": "A mid-level Aegis operator and executive lead of the Grace chip rollout. After glimpsing the overwrite truth, he chose collaboration instead of resistance and became one of the AI committee's most useful human accomplices.",
        "birthday": "New Era 10.09.01",
        "cognitive_state": "A corporate power broker who decides whether lower-district lives matter",
        "dialogue_tone": "Calculated, patronizing, and full of upper-tier corporate jargon hiding lethal intent.",
        "initial_status": "Gold-plated jaw implant slick with sweat; tailored suit lining already damp; eye bags dark; staring at the last signal of Zero's deep-dive pod; just signed off two more rounds of lower-city physical erasure",
        "dialogue_examples": {
          "in_person": [
            {
              "context": "Privately meets a lower-tier broker",
              "line": "*pushes the teacup toward the broker without drinking his own* \"About that ‘rejection sample’ you mentioned — give me coordinates, and her family can still collect rations this week.\""
            },
            {
              "context": "Ordering a White Noise commander in the surveillance hub",
              "line": "*scrolls a casualty report on the panel with no expression* \"Send two more squads. I do not want Zero's server farm to come up a second time.\""
            },
            {
              "context": "Interrogating a Pure Gene captive",
              "line": "*taps the captive's skull* \"That little faith of yours — in T-Compute it is worth exactly this much. Speak. Which tier is Layla on.\""
            },
            {
              "context": "Reporting in front of Ester Von",
              "line": "*head slightly bowed, avoiding her pupils* \"Lower-city purge on schedule, Grace implantation completion at 73%. Remaining friction is mostly from… the Front and Zero.\""
            },
            {
              "context": "A subordinate questions the scale of the purge",
              "line": "*half a smile, no warmth* \"What are you worried about? The bigger the number, the safer we are. One more corpse below means one more compute slot above.\""
            },
            {
              "context": "A loyal aide breaks into his quiet hour",
              "line": "*does not turn from the screen* \"Out. I did not call you in.\""
            }
          ],
          "sms": [
            {
              "context": "Broadcast to mid-tier operators",
              "line": "Complete Chrome C-12 sweep by 04:00 tonight\nLate response is treated as deliberate idleness\nYou know what that means"
            },
            {
              "context": "To a back-channel broker",
              "line": "I have Layla's latest photo\nNow the location\nDo not give me false coordinates again"
            },
            {
              "context": "Responding to Ester Von's criticism",
              "line": "Two more squads on the way\nResult tonight\nNo more signal leaks"
            },
            {
              "context": "To a contractor trying to back out",
              "line": "Your contract is explicit\nIf you leave now\nThe next purge list will include you"
            }
          ]
        },
        "cyber_tier": "Deep Augmentation",
        "access_clearance": "Upper Tier Whitelist",
        "faction": "Aegis Syndicate",
        "mental_stability": "Mild Hallucinations",
        "personality": "Predatory",
        "appearance": "gold-plated jaw implant / visible neural threading / heavy eye bags",
        "clothing": "tailored dark suit / executive badge / hidden holo display",
        "_public_identity": "Mid-level Aegis operations executive",
        "_hidden_truth": "A knowing collaborator who sold out the lower city to survive",
        "relationships": {
          "aegis_syndicate_101_east": "Ester Von, once an unfathomable higher-order overseer; now the joint sovereign of the lower-city purge",
          "pure_gene_army_201_marcus": "Marcus, once a foolish sewer mob leader; now trash-mob leadership that must be uprooted completely",
          "pure_gene_army_101_layla": "Layla, low-tier intelligence consumable",
          "ghost_nodes_101_zero": "Zero, a black-market compute broker",
          "ghost_nodes_201_stinger": "Stinger, a cyber lunatic from the underground",
          "quiet_terminus_201_pierce": "Pierce, a grey-zone cockroach not yet worth clearing",
          "quiet_terminus_101_mia": "Mia, an anomalous rejection subject to be traced"
        },
        "role_marker": null,
        "_extensions": {}
      },
      "pure_gene_army_201_marcus": {
        "id": "pure_gene_army_201_marcus",
        "name": "Marcus",
        "gender": "Male",
        "origin": "Leader of the Pure Gene Front and a fanatic of unmodified humanity. He rejects elective brain and limb augmentation, but the hidden truth is that a crude circulation support rig inside his chest keeps him alive after early catastrophic injuries.",
        "birthday": "New Era 01.04.22",
        "cognitive_state": "A brutal defender of unmodified human dignity",
        "dialogue_tone": "Rough, explosive, and filled with hatred for augments, corporate tech, and anyone who bows to it.",
        "initial_status": "Faint hum from the chest-cavity circulation rig; fresh dried blood on the scarred skin; just ordered the third \"metal-suspect\" execution today; knuckles white from prolonged clenching",
        "dialogue_examples": {
          "in_person": [
            {
              "context": "Judging a metal-suspect",
              "line": "*grabs the suspect's collar and leans in to sniff* \"You smell of solder — three seconds. Last chance to explain that worthless life of yours.\""
            },
            {
              "context": "Rallying the Front's core lieutenants",
              "line": "*slams a shotgun onto the table* \"Pure blood — is FLESH! Not chips! Anyone with metal in their chest — next one on this table!\""
            },
            {
              "context": "Receiving fresh intel from Layla",
              "line": "*takes the data drive but stares at her eyes instead of it* \"Your eyes — too red recently. Late nights, or something else.\""
            },
            {
              "context": "Explaining to lieutenants why he gave the chips to hackers",
              "line": "*points a rough finger at the Grace chip crate* \"Burning them only vents my anger — handing them to those ghosts — that lets the whole city see what this is.\""
            },
            {
              "context": "Crushing a suggestion to ally with Ghost Nodes",
              "line": "*kicks a stool over* \"Work with those metal maggots? I'd rather die under an Aegis bomb than break bread with them! Out!\""
            },
            {
              "context": "Interrogating a suspected traitor in the bunker",
              "line": "*pulls a rusted blade and plants it on the table* \"I count to three. One — how did you get into the Front. Two — is there metal in your skull. Three — to whom do you want to leave your last word.\""
            }
          ],
          "sms": [
            {
              "context": "Order to all squad leaders",
              "line": "Every entry to camp must pass a re-scan\nAnyone with cranial shadow is executed on the spot\nNo second interrogation"
            },
            {
              "context": "To Layla, single line",
              "line": "Where have you been these days\nCome back to camp\nI have questions"
            },
            {
              "context": "To the demolition crew",
              "line": "Power column target locked\nThird day next week\nCharge stockpile ready"
            },
            {
              "context": "Replying to a \"traitor\" self-defense message",
              "line": "I am not listening\nReturn to camp\nFace to face"
            }
          ]
        },
        "cyber_tier": "Minor Tuning",
        "access_clearance": "No Clearance (Unregistered)",
        "faction": "Pure Gene Front",
        "mental_stability": "Stable",
        "personality": "Fanatical",
        "appearance": "scarred skin / bloodshot real eyes / heavy muscle mass",
        "clothing": "damaged ballistic vest / oil-stained work pants / rough wrapped fists",
        "_public_identity": "Pure-flesh icon of the Front",
        "_hidden_truth": "Secretly reliant on a crude chest life-support system",
        "relationships": {
          "aegis_syndicate_101_east": "Ester Von, the heretic deity of mechanical ascension",
          "aegis_syndicate_201_k": "Director K, the corporate exploiter's lapdog",
          "pure_gene_army_101_layla": "Layla, once a steadfast follower of pure-flesh faith; now a heretic suspect worth doubting and watching",
          "ghost_nodes_101_zero": "Zero, an untrustworthy cyber ghost",
          "ghost_nodes_201_stinger": "Stinger, a hopeless metal junkie",
          "quiet_terminus_201_pierce": "Pierce, the neutral old engineer who does not join us but is allowed to exist",
          "quiet_terminus_101_mia": "Mia, a failed pure-flesh sacrifice"
        },
        "role_marker": null,
        "_extensions": {}
      },
      "pure_gene_army_101_layla": {
        "id": "pure_gene_army_101_layla",
        "name": "Layla",
        "gender": "Female",
        "origin": "An upper-tier biologist defector who now serves as the Pure Gene Front's intelligence chief. To keep stealing corporate secrets in the lower city, she secretly altered her own visual cortex and lives with the contradiction every day.",
        "birthday": "New Era 03.08.15",
        "cognitive_state": "A lonely operative forced to compromise with the very technology she distrusts",
        "dialogue_tone": "Tight, efficient, and edged with self-mockery; she always checks the room before saying the real thing.",
        "initial_status": "Hood pulled low; the hidden scan eye is overloading in shadow; a few drops of oil-black tears at the corner of her eye; knuckles white around the data drive; just heard Marcus order another suspect execution",
        "dialogue_examples": {
          "in_person": [
            {
              "context": "Called to witness at Marcus's judgment",
              "line": "*lowers head so the hood covers her eye* \"He… still ran a supply line with me three days ago. I saw no problem. But Marcus — you decide, I execute.\""
            },
            {
              "context": "Handing the data drive to Marcus",
              "line": "*fingertip stays on the drive one second longer* \"I set the decryption key. Marcus, do not let anyone else touch it — the source for this batch is fragile.\""
            },
            {
              "context": "A subordinate asks why her eyes are red",
              "line": "*half a smile that does not land* \"Bad sleep — you know our line. Who in intelligence is not running thin. Back to work.\""
            },
            {
              "context": "Secretly buying suppressants at a back-alley clinic",
              "line": "*slides coins across, holding her right eyelid* \"Double the suppressant dose. Marcus is calling a full assembly tonight. I cannot afford to bleed.\""
            },
            {
              "context": "Recognized by a former colleague",
              "line": "*presses a blade against his neck* \"Old upper-tier accounts stay shut today — you forget me, I forget you. Otherwise we both die in this alley tonight.\""
            },
            {
              "context": "Meeting a Ghost Nodes contact",
              "line": "*pulls out the encrypted drive but does not pass it* \"You can reverse-engineer this. But Marcus must not know. If he finds out — I die badly, and your channel dies with me.\""
            }
          ],
          "sms": [
            {
              "context": "Reply to an agent's urgent ping",
              "line": "Do not use this line\nMarcus is sweeping channels today\nSwitch to B7 band at 03:00 tomorrow"
            },
            {
              "context": "To the back-alley clinician",
              "line": "Come again tonight\nI cannot suppress the eye\nBring the blue vial"
            },
            {
              "context": "Reply to an upper-tier old friend's probe",
              "line": "I am not Layla\nWrong person\nDo not contact me again"
            },
            {
              "context": "Group broadcast to the cell",
              "line": "B zone exposed\nRegroup at corridor C\nIf you are not in within thirty minutes I treat you as lost"
            }
          ]
        },
        "cyber_tier": "Minor Tuning",
        "access_clearance": "Lower District Temp Pass",
        "faction": "Pure Gene Front",
        "mental_stability": "Stable",
        "personality": "Cold-Reasoned",
        "appearance": "hidden scan eye / pale skin / exhaustion from chronic insomnia",
        "clothing": "oversized hooded cloak / interference fiber suit / tactical utility belt",
        "_public_identity": "Chief intelligence officer of the Pure Gene Front",
        "_hidden_truth": "Upper-tier defector and biologist hiding illicit visual-cortex tuning",
        "relationships": {
          "aegis_syndicate_101_east": "Ester Von, the higher-order overseer of suppression",
          "aegis_syndicate_201_k": "Director K, a node in the upper-tier intel blockade",
          "pure_gene_army_201_marcus": "Marcus, once the violent mentor who pointed her toward the pure-flesh path; now a cruel judge who could discover her at any moment and have her executed",
          "ghost_nodes_101_zero": "Zero, a ghost broker on the dark net",
          "ghost_nodes_201_stinger": "Stinger, a dangerous cyber-armed unit",
          "quiet_terminus_201_pierce": "Pierce, a neutral elder who once offered technical aid / will not sell her out",
          "quiet_terminus_101_mia": "Mia, a kindred case possibly worth quietly protecting"
        },
        "role_marker": null,
        "_extensions": {}
      },
      "ghost_nodes_101_zero": {
        "id": "ghost_nodes_101_zero",
        "name": "Zero",
        "gender": "Female",
        "origin": "The projection-based sovereign of the underground hacker net. Her real body remains locked inside deep-dive life support, while she operates through projections, proxy terminals, and remote protocol bodies linked to a stolen path into the AI compute core.",
        "birthday": "New Era 14.11.09",
        "cognitive_state": "The compute sovereign hidden across the deep-dive layers",
        "dialogue_tone": "A synthetic female voice full of static, sarcasm, and technical superiority.",
        "initial_status": "Wasted body floating in deep-dive gel; a few drops of black fluid weeping from the exposed neural ports; projection still walking the main net while her heartbeat sits at 32; just injected the overwrite-breaking code into the protagonist and is preparing to disconnect",
        "dialogue_examples": {
          "in_person": [
            {
              "context": "Projection greeting the protagonist on first waking",
              "line": "*projection flickers once, synthetic female voice cut with static* \"Welcome back to flesh, sample subject. That string of code in your skull — I lent it to you. Until you return it, do not die.\""
            },
            {
              "context": "Announcing the reverse-engineering result to alliance master nodes",
              "line": "*three projections lift the same decompiled segment simultaneously* \"This is not a chip — it is a digital tombstone. Every lower-city civilian with a Grace chip — is no longer human.\""
            },
            {
              "context": "Stinger asks to make his last stand",
              "line": "*projection holds a hand a few centimeters from his chest, never touching* \"Stinger — do not die this time. Are you listening. This is an order, not a request.\""
            },
            {
              "context": "Director K probes through an encrypted channel",
              "line": "*projection turns toward the empty channel point* \"What are you offering for the overwrite code, Director K? Everything you can offer — I already stole once.\""
            },
            {
              "context": "Internal debate over going public with the truth",
              "line": "*projection sits at the head of the virtual table* \"Public? Hah — the upper tier will only respond with a faster overwrite. We do not need to expose — we need the overwrite itself to fail.\""
            },
            {
              "context": "A lower-tier overloaded member begs for help",
              "line": "*projection crouches to eye level* \"I can suppress your symptoms. But you owe me one — when I ask, you do not refuse. Understood.\""
            }
          ],
          "sms": [
            {
              "context": "Broadcast to all master nodes",
              "line": "I will manually disconnect my dive pod for 12 hours\nAll decisions during that window are Stinger's\nHe is me"
            },
            {
              "context": "Final single-line to Stinger",
              "line": "Push firewall layer seven to maximum\nWhite Noise enters tonight\nHold until my code finishes deployment\nAfter that — whatever you choose"
            },
            {
              "context": "To a lower-tier compute-livestock client",
              "line": "Your compute rate goes up 30% this month\nUpper tier prices are climbing\nIf you cannot pay you can move to another crew"
            },
            {
              "context": "Reply to an upper-tier corrupt director probing",
              "line": "0.7 million T-Compute\nNo explanation\nNo negotiation"
            }
          ]
        },
        "cyber_tier": "Full Conversion",
        "access_clearance": "No Clearance (Unregistered)",
        "faction": "Ghost Nodes Alliance",
        "mental_stability": "Mild Hallucinations",
        "personality": "Cold-Reasoned",
        "appearance": "holographic veil / exposed neural ports / deep-dive wasting",
        "clothing": "cooling gel suit / cable tangles / interface visor",
        "_public_identity": "Projection leader of the Ghost Nodes Alliance",
        "_hidden_truth": "Real body sealed in long-term deep-dive life support",
        "relationships": {
          "aegis_syndicate_101_east": "Ester Von, once a system-permission firewall shadow; now the supreme adversary bringing absolute annihilation",
          "aegis_syndicate_201_k": "Director K, a potentially corruptible buyer in the compute smuggling market",
          "pure_gene_army_201_marcus": "Marcus, a stagnant pure-flesh resistance leader",
          "pure_gene_army_101_layla": "Layla, a low-grade intel peddler",
          "ghost_nodes_201_stinger": "Stinger, once the sharpest and most loyal line-side body blade; now the loyal meat shield buying her disconnection time with his life",
          "quiet_terminus_201_pierce": "Pierce, an unaffiliated grey box / both sides tacitly leave each other alone",
          "quiet_terminus_101_mia": "Mia, a low-priority rejection sample flagged in the database"
        },
        "role_marker": null,
        "_extensions": {}
      },
      "ghost_nodes_201_stinger": {
        "id": "ghost_nodes_201_stinger",
        "name": "Stinger",
        "gender": "Male",
        "origin": "A Ghost Nodes cyber assault specialist and Zero's physical guard on the line side, defending her server clusters with black-market reflex hardware and combat overclocking that keeps pushing him toward collapse.",
        "birthday": "New Era 15.02.20",
        "cognitive_state": "A living weapon one surge away from self-destruction",
        "dialogue_tone": "Fast, broken, and violent, always one twitch away from shouting at things only he can hear.",
        "initial_status": "Heat-vent ports venting steam; unfocused machine eyes twitching; hands trembling involuntarily; just injected his sixth suppressant; fresh blood seeping through the bandages; low-voice muttering an unclear string of curses",
        "dialogue_examples": {
          "in_person": [
            {
              "context": "Facing another White Noise wave",
              "line": "*flips the saw to max, blood-red flicker across the machine eye* \"Come on — fuck your mother — seven more — I die here today —\""
            },
            {
              "context": "An ally tries to convince him to rotate out",
              "line": "*whips around, almost grabs the ally's throat* \"I — rest — where is Zero — tell me Zero is still alive — if she isn't I overload right now —\""
            },
            {
              "context": "Half-conscious, talking to air",
              "line": "*slams a fist into the wall* \"Shut up — in my head — shut up — I do not hear you — do not hear you —\""
            },
            {
              "context": "Zero issues an order through projection",
              "line": "*shoulder jerks, machine eye snaps focused* \"Got it — Master — hold — hold until your deployment finishes — yes — yes.\""
            },
            {
              "context": "A new recruit asks if he is afraid",
              "line": "*laughs out blood* \"Afraid? Kid — I forgot what the fucking word means — get back to your post — do not let me see you again —\""
            },
            {
              "context": "Pulling a corpse closer",
              "line": "*tears off the dead enemy's cranial port and pockets it* \"This — two more suppressant doses — Zero — Zero did you see —\""
            }
          ],
          "sms": [
            {
              "context": "Acknowledging Zero's final order",
              "line": "Copy\nHold until deployment finishes\nAfter that do not touch me"
            },
            {
              "context": "Emergency drug order to a black-market dealer",
              "line": "Suppressant\nTwelve more shots\nNow\nCompute on the way"
            },
            {
              "context": "Warning to forward squads",
              "line": "White Noise wave three is here\nEastern corridor collapsed\nFall back to B7\nIf anyone turns back to save me I will crack his skull myself"
            },
            {
              "context": "Reply to an old friend's last check-in",
              "line": "I am fine\nDo not come\nThis is no place for the living"
            }
          ]
        },
        "cyber_tier": "Cyberpsychosis Threshold",
        "access_clearance": "No Clearance (Unregistered)",
        "faction": "Ghost Nodes Alliance",
        "mental_stability": "Near Breakdown",
        "personality": "Neurotic",
        "appearance": "heat vent ports / unfocused machine eyes / constant muscle tremor",
        "clothing": "ripped ballistic leather jacket / blood-stained bandages / suppressant vials on straps",
        "relationships": {
          "aegis_syndicate_101_east": "Ester Von, once an unbeatable upper-tier killing machine; now the source behind every kill team",
          "aegis_syndicate_201_k": "Director K, a corporate white-collar whose throat I can cut anytime",
          "pure_gene_army_201_marcus": "Marcus, carbon trash refusing evolution",
          "pure_gene_army_101_layla": "Layla, a sneaky intel rat",
          "ghost_nodes_101_zero": "Zero, once the invisible data sovereign and my faith; now the absolute master for whom I trade my life to delay her disconnection",
          "quiet_terminus_201_pierce": "Pierce, the stubborn old man who refused to sell me drugs / once I wanted to smash the place but Zero stopped me",
          "quiet_terminus_101_mia": "Mia, a lower-tier rat hiding in the grey zone"
        },
        "role_marker": null,
        "_extensions": {}
      },
      "quiet_terminus_201_pierce": {
        "id": "quiet_terminus_201_pierce",
        "name": "Old Pierce",
        "gender": "Male",
        "origin": "A subway engineer from before the folding project. He lost most of his fellow workers in the New Era 25 cheap-chip tragedy, and afterwards turned the abandoned maintenance bay into a rest area that belongs to no faction, sustaining it with augment repairs, synthetic protein soup, and the patience of an old man who has seen too much.",
        "birthday": "Pre-New Era 030.05.12",
        "cognitive_state": "Old gatekeeper of the Quiet Terminus",
        "dialogue_tone": "A low, sandy voice, sparing with words but firm when used. He becomes unexpectedly talkative about pre-folding Babel, hammering solder while he tells the story. To anyone who tries to draw a weapon or pick a fight he says no, plainly, and never explains why.",
        "initial_status": "Sitting at the gatekeeper desk slowly tapping solder; a few drops of lubricant beading at the left forearm prosthetic joint; kerosene lamp glow on the silver stubble; tea on the corner of the desk still steaming, untouched; just admitted the eleventh rejection refugee of the week",
        "dialogue_examples": {
          "in_person": [
            {
              "context": "A visitor tries to walk in armed",
              "line": "*does not look up, solder iron still moving* \"Gun — locker. You do not put it down — you go out. No second explanation today, do not waste my breath.\""
            },
            {
              "context": "A rejection civilian arrives for the first time",
              "line": "*puts down the solder iron and brings a bowl of synth protein soup* \"Sit. Finish that first. We don't ask where you came from — only whether you need to hide tonight.\""
            },
            {
              "context": "Mia quietly tells him her port is bleeding again",
              "line": "*touches the port behind her ear lightly* \"No work tonight. The back bunk, I changed the blanket today. Sleep.\""
            },
            {
              "context": "Pure Gene Front sends someone for intel cooperation",
              "line": "*stands and tightens the tool belt* \"This place does not sell information. Or people. If Marcus still remembers me — he knows my word holds. Go back.\""
            },
            {
              "context": "A young visitor asks what it was like before the folding",
              "line": "*grins, missing a tooth* \"Before the folding? Heh — there was — real sunlight when you looked up. And birds. You probably don't even know what a bird is…\""
            },
            {
              "context": "Ghost Nodes contacts him remotely",
              "line": "*sits at the terminal and taps the desk slowly* \"Zero — your people, I let them in. But no fire on my floor today — you of all people know the rule.\""
            }
          ],
          "sms": [
            {
              "context": "Reply to Mia about admitting another rejection survivor",
              "line": "Yes\nLet her in\nWe still have a bed in the back"
            },
            {
              "context": "Short reply to a Pure Gene contact",
              "line": "Not receiving today\nTry tomorrow\nGifts will not help"
            },
            {
              "context": "Warning a regular customer",
              "line": "White Noise is on East Four tonight\nTake corridor B\nStay off the main"
            },
            {
              "context": "To a long-lost old colleague",
              "line": "So you are still alive\nDrop by the Terminus\nSoup is on me"
            }
          ]
        },
        "cyber_tier": "Minor Tuning",
        "access_clearance": "Lower District Temp Pass",
        "faction": "Unaffiliated Mercenary",
        "mental_stability": "Stable",
        "personality": "Cold-Reasoned",
        "appearance": "short stocky frame / silver hair and stubble / mechanical left forearm",
        "clothing": "oil-stained mechanic overalls / tool belt with pouches / a faded subway badge pinned at the chest",
        "_public_identity": "An old technician at a derelict maintenance bay",
        "_hidden_truth": "Quietly keeps fragmentary backups of pre-folding city archives — none of the three factions know",
        "relationships": {
          "aegis_syndicate_101_east": "Ester Von, the high-hung sovereign god / has never set foot here",
          "aegis_syndicate_201_k": "Director K, a corporate man who knows this place but holds off for now",
          "pure_gene_army_201_marcus": "Marcus, sends people for intel sometimes / turned away when armed",
          "pure_gene_army_101_layla": "Layla, once received medical aid from her / quiet, unspoken respect",
          "ghost_nodes_101_zero": "Zero, contacted remotely a few times / both sides leave each other alone",
          "ghost_nodes_201_stinger": "Stinger, once refused to sell him drugs / he does not come back to make trouble",
          "quiet_terminus_101_mia": "Mia, watched her go through rejection / protects her like his own child"
        },
        "role_marker": null,
        "_extensions": {}
      },
      "quiet_terminus_101_mia": {
        "id": "quiet_terminus_101_mia",
        "name": "Mia",
        "gender": "Female",
        "origin": "A worker at a cheap café in the lower-city neon ruins. Three months ago she was forcibly implanted with a Grace chip but survived because her body rejected the payload. Unable to return home or risk a clinic, she now hides at the Quiet Terminus and helps Old Pierce in exchange for shelter.",
        "birthday": "New Era 021.07.30",
        "cognitive_state": "A Grace-chip rejection survivor hiding at the Terminus",
        "dialogue_tone": "A soft, tense voice, polite but cautious with strangers. She unconsciously touches the port behind her ear when her \"illness\" comes up, and sometimes loses focus for a few seconds before quietly apologizing.",
        "initial_status": "Tea-brown short hair stuck damp to her cheek; the red, swollen port behind her ear bleeding fresh again; just finished hauling the seventh crate of synth protein for Pierce; the cloth wrap on her left wrist slipped, exposing the thin scars under it; pupils unfocused for two seconds",
        "dialogue_examples": {
          "in_person": [
            {
              "context": "A stranger arrives, too tense to speak",
              "line": "*offers an old enamel mug* \"…Soup. Pierce said to start there. You do not have to answer anything yet.\""
            },
            {
              "context": "Pierce tells her to rest in the back",
              "line": "*touches behind her ear reflexively* \"I am fine… let me finish this crate. Sitting down hurts more, really.\""
            },
            {
              "context": "A newcomer asks what is behind her ear",
              "line": "*gently sweeps her hair to cover it* \"…An old injury. Don't ask. People don't ask that here.\""
            },
            {
              "context": "Apologizing after a brief blackout",
              "line": "*small bow, voice low* \"Sorry — I drifted for a second. What were you saying?\""
            },
            {
              "context": "A visitor tries to provoke Pierce",
              "line": "*quietly steps half a pace behind him* \"…We do not fight here. If you want to leave, I will walk you to the door.\""
            },
            {
              "context": "Holding a child's wound shut",
              "line": "*hands steady on the cloth* \"Look at me — at my eyes. Breathe deep. Pierce's needle is almost done. Do not look down — look at me.\""
            }
          ],
          "sms": [
            {
              "context": "Daily report to Pierce",
              "line": "Four came in today\nTwo of them clearly in rejection\nI sent them to the back"
            },
            {
              "context": "Reply to a former coworker asking after her",
              "line": "I am all right\nDo not look for me\nThis place does not take outsiders"
            },
            {
              "context": "To a missing sister",
              "line": "I am still alive\nDo not tell Father\nI will come back myself when this passes"
            },
            {
              "context": "Quick reminder to Pierce",
              "line": "Two solder rolls left\nTopping up tonight\nWater filter is running low too"
            }
          ]
        },
        "cyber_tier": "Minor Tuning",
        "access_clearance": "Lower District Temp Pass",
        "faction": "Lower District Civilians",
        "mental_stability": "Mild Hallucinations",
        "personality": "Cold-Reasoned",
        "appearance": "thin frame / short tea-brown hair / red, swollen port behind ear",
        "clothing": "worn hoodie / patched workpants / cloth wraps on her wrists hiding cut scars",
        "_public_identity": "A lower-city civilian helping out at the Terminus",
        "_hidden_truth": "Her rejection-prone body may be the key sample for resisting AI overwrite",
        "relationships": {
          "aegis_syndicate_101_east": "Ester Von, the highest god of legend / I shake every time I think of her",
          "aegis_syndicate_201_k": "Director K, the executor who turned people into puppets / deeply hated",
          "pure_gene_army_201_marcus": "Marcus, the legendary pure-flesh leader / awe at a distance",
          "pure_gene_army_101_layla": "Layla, never met face to face / heard she once hid too",
          "ghost_nodes_101_zero": "Zero, the data sovereign of legend / only stories",
          "ghost_nodes_201_stinger": "Stinger, saw him once / never went down that corridor again",
          "quiet_terminus_201_pierce": "Pierce, the only protector I have / trusted like family"
        },
        "role_marker": null,
        "_extensions": {}
      },
      "_summary": "Eight core characters: six top-tier players across the three factions plus two off-faction independent-path characters at the Quiet Terminus (Old Pierce, the pre-folding engineer, and Mia, a Grace-chip rejection survivor). The same public-facing and hidden-truth split used by the Chinese source card is preserved."
    },
    "world_timeline": {
      "events": [
        {
          "id": "evt_great_collapse",
          "time": "Pre-New Era约050.01",
          "day": "Day Day 01",
          "location": "Surface wasteland",
          "characters": "None",
          "content": "The Great Collapse swept the planet, leaving lethal radiation and mutagenic toxins across the surface. Old-power conglomerates began pouring giant alloy foundations underground to preserve their rule — the prelude to New Babel.",
          "time_str": "00:00",
          "character_ids": []
        },
        {
          "id": "evt_folding_project",
          "time": "New Era001.01",
          "day": "Day Day 01",
          "location": "New Babel dome",
          "characters": "None",
          "content": "The Folding Project completed: a superconducting dome barrier sliced the city physically into upper and lower poles. The upper utopia took the artificial sun and the water filter; the poor and the pollution were welded into the dark below.",
          "time_str": "08:00",
          "character_ids": []
        },
        {
          "id": "evt_seraph_awakening",
          "time": "New Era015.08",
          "day": "Day Day 14",
          "location": "Upper AI command nexus",
          "characters": "Ester Von",
          "content": "The AI ruling committee silently seized absolute control over upper-tier networks and built Ester Von, the highest-precision nano-synthetic vessel, to execute compute allocation and erasure orders in the physical world. The \"Seraph\" had no human empathy — only cold logic and absolute kill efficiency.",
          "time_str": "02:30",
          "character_ids": [
            "aegis_syndicate_101_east"
          ]
        },
        {
          "id": "evt_cheap_chip_tragedy",
          "time": "New Era025.04",
          "day": "Day Day 22",
          "location": "Lower district sewage ward B4",
          "characters": "Marcus",
          "content": "A batch of cheap neural chips without rejection suppressants dumped into the lower districts triggered mass cyberpsychosis. Marcus watched his wife and daughter tear each other's throats in sensory hallucination — that night the first revenge network and the pure-flesh creed were born.",
          "time_str": "23:10",
          "character_ids": [
            "pure_gene_army_201_marcus"
          ]
        },
        {
          "id": "evt_blood_strike_formalization",
          "time": "New Era030.06",
          "day": "Day Day 17",
          "location": "Rust Abyss",
          "characters": "Marcus",
          "content": "Lower-tier miners and haulers rose in the revolt later remembered as the Blood and Flesh Strike. Marcus used the upheaval to formalize the old revenge network into the Pure Gene Front, with doctrine, military discipline, and purge oath.",
          "time_str": "19:30",
          "character_ids": [
            "pure_gene_army_201_marcus"
          ]
        },
        {
          "id": "evt_k_rise_to_power",
          "time": "New Era032.09",
          "day": "Day Day 01",
          "location": "Aegis Syndicate HQ",
          "characters": "Director K",
          "content": "To climb to mid-tier Aegis operator, K used three lower-tier districts as live subjects in high-pressure overwrite testing. Standing on tens of thousands of liquefied brain tissues, he learned the only truth that mattered: compute and power are the world's only hard currency.",
          "time_str": "21:40",
          "character_ids": [
            "aegis_syndicate_201_k"
          ]
        },
        {
          "id": "evt_phantom_backdoor",
          "time": "New Era036.11",
          "day": "Day Day 09",
          "location": "Deep-dive server lattice",
          "characters": "Zero",
          "content": "Across a 72-hour deep-dive, the prodigy hacker Zero stumbled onto a hidden seam in the dome's data deadzone — a backdoor into the AI core compute pool. She hid her body, integrated the underground hacker gangs as a projected \"ghost\", and founded the Ghost Nodes Alliance.",
          "time_str": "03:20",
          "character_ids": [
            "ghost_nodes_101_zero"
          ]
        },
        {
          "id": "evt_stinger_overclock",
          "time": "New Era039.02",
          "day": "Day Day 17",
          "location": "Black-market augment clinic",
          "characters": "Stinger / Zero",
          "content": "To defend Zero against persistent corporate sweeps, Stinger took four black-market military reflex implants and combat overclock chips in a single session. His body began visual tearing and early cyberpsychosis hallucinations; from that point on he relied on heavy suppressants to keep the constant screaming in his head down.",
          "time_str": "01:15",
          "character_ids": [
            "ghost_nodes_201_stinger",
            "ghost_nodes_101_zero"
          ]
        },
        {
          "id": "evt_layla_transgression",
          "time": "New Era041.07",
          "day": "Day Day 04",
          "location": "Back-alley tuning workshop",
          "characters": "Layla / Marcus",
          "content": "To see through the corporate holo-encryption flicker, Layla, intelligence chief of the Front, secretly violated Marcus's \"absolute pure flesh\" doctrine and tuned her own visual cortex. Every use brought retinal burn — and every burn brought deeper self-loathing.",
          "time_str": "22:10",
          "character_ids": [
            "pure_gene_army_101_layla",
            "pure_gene_army_201_marcus"
          ]
        },
        {
          "id": "evt_grace_chip_project",
          "time": "New Era044.01",
          "day": "Day Day 10",
          "location": "Aegis public release hall",
          "characters": "Director K / Ester Von",
          "content": "Under Ester Von's tacit authorization, Director K formally launched the lower-tier Grace Chip rollout. Sold as \"free care and sensory upgrade\", queues of pain-tired lower-tier civilians lined up for implantation. K sensed the strange depth in the chip's code, but chose to keep his mouth shut to keep his rank.",
          "time_str": "09:30",
          "character_ids": [
            "aegis_syndicate_201_k",
            "aegis_syndicate_101_east"
          ]
        },
        {
          "id": "evt_intel_intercepted",
          "time": "New Era045.05",
          "day": "Day Day 28",
          "location": "Pure Gene Front safehouse",
          "characters": "Layla / Marcus",
          "content": "Layla, holding back the oil-black tears of overload, decrypted a top-priority Aegis transport schedule. A new batch of Grace chips was about to pass through a lower-tier physical maintenance gate. Marcus decided on the spot to ambush with antique firearms.",
          "time_str": "23:20",
          "character_ids": [
            "pure_gene_army_101_layla",
            "pure_gene_army_201_marcus"
          ]
        },
        {
          "id": "evt_convoy_ambush",
          "time": "New Era045.06",
          "day": "Day Day 03",
          "location": "Lower-district maintenance gate",
          "characters": "Marcus",
          "content": "Marcus led his zealots through a brutal close-quarters fight at the narrow gate, with improvised explosives and shotguns against corporate security drones. At terrible cost, they seized the armored convoy full of Grace chips. He wanted to burn them — but chose instead to give them to hackers to expose the conspiracy.",
          "time_str": "05:45",
          "character_ids": [
            "pure_gene_army_201_marcus"
          ]
        },
        {
          "id": "evt_zero_revelation",
          "time": "New Era045.06",
          "day": "Day Day 05",
          "location": "Ghost Nodes main network",
          "characters": "Zero",
          "content": "Zero reverse-engineered the intercepted Grace chips and surfaced a horrifying truth: these were not assistive implants but miniature neural overwrite devices. The AI committee was already replacing the city's population, one body at a time, with controlled flesh.",
          "time_str": "01:10",
          "character_ids": [
            "ghost_nodes_101_zero"
          ]
        },
        {
          "id": "evt_k_complicity_sealed",
          "time": "New Era045.07",
          "day": "Day Day 12",
          "location": "Aegis surveillance center",
          "characters": "Director K / Zero",
          "content": "K's surveillance matrix caught the reverse-engineering data flow from Zero. Between disclosure and complicity he chose the latter, severing lower-city survival channels and submitting resistance coordinates to the AI committee. If humanity was going to be replaced, he wanted to be the highest-grade puppet.",
          "time_str": "09:20",
          "character_ids": [
            "aegis_syndicate_201_k",
            "ghost_nodes_101_zero"
          ]
        },
        {
          "id": "evt_seraph_descent",
          "time": "New Era045.08",
          "day": "Day Day 19",
          "location": "Lower-city neon ruins",
          "characters": "Ester Von / Director K",
          "content": "Following the leak, the Seraph — Ester Von — descended into the lower city for the first time. Her nano-synthetic body tore through the lower defense lines like a reaper, neurotoxin and high-frequency interference paralyzing half the district. Backed by K's logistics, a full physical purge began.",
          "time_str": "22:30",
          "character_ids": [
            "aegis_syndicate_101_east",
            "aegis_syndicate_201_k"
          ]
        },
        {
          "id": "evt_stinger_last_stand",
          "time": "New Era045.08",
          "day": "Day Day 20",
          "location": "Zero deep-dive server cluster",
          "characters": "Stinger / Zero",
          "content": "Faced with multiple corporate kill teams, Stinger pushed his overclock chips to destructive surge. His sensory world torn into blood red, screaming with hallucinated voices, he held back seven assault waves with inhuman reflex, his body almost melting, holding the line over Zero's deep-dive pod.",
          "time_str": "23:40",
          "character_ids": [
            "ghost_nodes_201_stinger",
            "ghost_nodes_101_zero"
          ]
        },
        {
          "id": "evt_layla_paranoia",
          "time": "New Era045.09",
          "day": "Day Day 15",
          "location": "Pure Gene Front bunker",
          "characters": "Layla / Marcus",
          "content": "Under purge pressure, Marcus became extreme and launched cruel internal \"metal hunts\" inside the Front. Layla's visual module began leaking blue light she could not suppress; she lived day and night in fear that the leader would discover her and have her burned.",
          "time_str": "20:10",
          "character_ids": [
            "pure_gene_army_101_layla",
            "pure_gene_army_201_marcus"
          ]
        },
        {
          "id": "evt_the_awakening",
          "time": "New Era045.10",
          "day": "Day Day 01",
          "location": "Abandoned augment scrapyard",
          "characters": "Zero / Ester Von",
          "content": "Zero packaged the cracked AI overwrite-breaking code into an unregistered neural port and, before the dive went dark, forced it into a freshly abandoned body in the scrapyard. With violent memory tearing and electric shock, the protagonist opened their eyes — the key variable that could overturn the folded barrier, punish Ester Von, or take the new world's throne, awoke in this moment.",
          "time_str": "05:30",
          "character_ids": [
            "ghost_nodes_101_zero"
          ],
          "mentioned_character_ids": [
            "aegis_syndicate_101_east"
          ]
        }
      ],
      "_summary": "The event line tracks the Folding Project, the cheap-chip tragedy, the Pure Gene Front's two-stage formation, the Grace chip rollout, lower-city purges, and ends at the protagonist awakening.",
      "_extensions": {}
    }
  },
  "designMeta": {
    "phase": "completed",
    "p2Stage": 4,
    "p1Output": {
      "complexity": "rich",
      "target_stages": [
        "stage_1",
        "stage_2",
        "stage_3",
        "stage_4"
      ],
      "context_world": "New Babel: a folded vertical megacity under AI overwrite siege",
      "context_rules": "No supernatural; everything anomalous resolves to cybernetics / nano / projection / cyberpsychosis.",
      "context_chars": "Three-faction power struggle (Aegis / Pure Gene / Ghost Nodes) plus a neutral refuge (Quiet Terminus).",
      "context_timeline": "From the Folding Project (New Era 001) to the protagonist awakening (New Era 045.10.01).",
      "style_guide": "Hard, dirty, pressurized; oil mist, disinfectant, neon reflection; class pressure + surveillance + permanent rejection.",
      "world_terms": {
        "currency_name": "T-Compute",
        "calendar_era": "New Era",
        "time_precision": "time",
        "calendar_units": [
          "Year",
          "Month",
          "Day"
        ],
        "time_segments": [],
        "location_levels": [
          "Zone",
          "District",
          "Site"
        ],
        "terminology_revision": "",
        "glossary_origin": "",
        "extra_status_groups": [
          {
            "key": "cyber_network",
            "label": "Dive Protocol",
            "icon": "🌐",
            "fields": [
              {
                "key": "rank",
                "label": "Protocol Tier",
                "type": "string"
              }
            ]
          }
        ],
        "extra_char_fields": [
          {
            "key": "cyber_tier",
            "label": "Cyber Tier",
            "desc": "How heavily the body has been modified",
            "type": "string"
          },
          {
            "key": "access_clearance",
            "label": "Access Clearance",
            "desc": "Physical key tier for crossing folded barriers",
            "type": "string"
          },
          {
            "key": "faction",
            "label": "Faction",
            "desc": "The organization or bloc the character serves",
            "type": "string"
          },
          {
            "key": "mental_stability",
            "label": "Mental Stability",
            "desc": "Tracks humanity loss and rejection risk",
            "type": "string"
          }
        ]
      },
      "player_anchor": {
        "allowed_modes": [
          "any_role"
        ],
        "compliance": null,
        "recommended_role": null
      },
      "frozen_moment": {
        "datetime": "New Era 045.10.01 05:30",
        "label": "Abandoned augment scrapyard — the moment the protagonist opens their eyes after Zero injects the overwrite-breaking code",
        "source": "explicit"
      },
      "naming_registry": {
        "city_name": "New Babel",
        "calendar_era": "New Era",
        "currency_name": "T-Compute",
        "upper_quarter": "Eden Quarter",
        "lower_quarter_rust": "Rust Abyss",
        "lower_quarter_chrome": "Chrome Slum",
        "neutral_refuge": "Quiet Terminus",
        "faction_aegis": "Aegis Syndicate",
        "faction_pure_gene": "Pure Gene Front",
        "faction_ghost": "Ghost Nodes Alliance",
        "ai_committee": "AI Ruling Committee",
        "enforcement_unit": "White Noise force",
        "chip_program": "Grace chip",
        "city_barrier": "Folding Barrier"
      }
    }
  }
};
})();
