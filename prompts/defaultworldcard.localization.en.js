(function () {
  'use strict';

  const base = globalThis.__BUILTIN_DEFAULT_WORLD_CARD__;
  if (!base || !base.snapshot || typeof base.snapshot !== 'object') return;

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  const entityTexts = {
    sanchadu_town: `## Entity Setting -- Sanchadu Town

[Geography_Appearance]
Sanchadu Town stands on the south bank of the middle inland river, an old crossing and cargo-transfer node along the waterway. The stone-paved main street runs from the ferry dock to the town center; a gate at the south end leans west toward Mistwood Road, while an eastern dirt track leads to the farmland. You can walk across the whole town in about fifteen minutes, but the dock, the old tower, the farms, and the north-bank market make it feel busier than its size suggests.

[Functions_Activity]
The town is small, yet unusually dense in administration, freight handling, and archival work because it has long handled crossing registration, cargo transfer, and old records. The Resting Stone inn provides beds and rumors, the notice board gathers odd jobs and errands, the grain store and smithy keep daily life moving, and a small schoolhouse on the middle of the main street is run by a teacher's family across generations; this month the teaching couple is away visiting relatives and buying new schoolbooks, so daily classes are mostly held by their daughter Iris. During bridge repairs, the bridge worksite and the dock become the focus of nearly every conversation. The north-bank market is fully open on the 1st, 6th, 11th, 16th, 21st, and 26th of each month; the surrounding days are busiest, while ordinary days revolve around errands, messenger runs, registration, checking cargo, and small trade.

[Key_People_Factions]
Town affairs are handled by three or four rotating elders rather than a lord — this month's chair is the steady, traditionalist Elder Hale, while the smoother, more flexible Elder Brun often speaks differently when negotiating outside, and the two do not always present a unified front. River order and crossings are overseen by the river office patrol officer Sera, whose relationship with the elders has never been smooth, especially with Brun over the matter of negotiating special passage terms behind the river office's back. Robin runs the central notice board and hears most things sooner rather than later. Jonah keeps the Resting Stone, Mara watches the grain accounts, and Tessa works through the old tower records that many locals would rather leave alone.

[Common_Stops]
The front hall of the Resting Stone, the notice board in the town center, the grain-store counter, the smithy forge room, and the fence outside the bridge worksite are the most common places to talk, wait, and stumble into clues.

[Baseline_Use]
Outside the March 325 repair-and-discrepancy window, the town settles into a steady routine: ferries keep their schedule, the notice board mostly posts errands and short-term work, and the north-bank market follows its fixed cycle. Travelers mainly come for lodging, trade, escort work, and social ties. Daytime brings foot traffic and shouted business; by evening, the inn hall is the liveliest place in town.`,
    ferry_dock: `## Entity Setting -- Ferry Dock

[Geography_Appearance]
The dock sits on the north riverbank edge of town, down a short flight of stone steps from the end of the main street. It includes a roofed ticket booth, waiting benches, a cargo holding area, a river-office notice board, and floating piers for the flat-bottom ferries. When the water rises, workers sometimes have to wade to move cargo.

[Functions_Activity]
This is the town's only formally registered ferry crossing. In normal times the bridge also handles part of the north-south traffic, but official registration for people and cargo still centers on the dock. During bridge repairs, almost all cross-river movement is squeezed through this bottleneck, so queues, inspections, ticket adjustments, and arguments happen more often. Ferries usually run four to six times a day, with extra runs around market days.

[Key_People_Factions]
Mina is the familiar face at the ticket booth and knows both the schedules and the regulars. Sera patrols here for smuggling, illegal crossings, and forbidden goods. Laborers, brokers, and job-seekers also gather nearby because this is where rules and profit collide.

[Common_Stops]
Ticket booth, waiting benches, cargo holding area, river-office notice board, floating pier entrance.

[Atmosphere_Interaction]
The dock is calmest before the first morning ferry leaves. After that it fills with queue noise, bargaining, and cargo calls. By dusk, once the last ferry is done, only cargo watchers and an occasional night fisher remain. Players can buy passage, ask around, track cargo movement, or take hauling work for silver.`,
    north_market: `## Entity Setting -- North Bank Market

[Geography_Appearance]
The market lies above the north-bank landing on a packed-earth riverside flat. A ferry ride from town takes about fifteen minutes. Ropes and posts divide the ground into stall lanes, and a few semi-permanent wooden sheds on the edge serve as bulk cargo storage. On market days the space is crowded with tents and flags; on non-market days it feels sparse, with only leftover goods, watchmen, and a few merchants finishing up.

[Functions_Activity]
The market is fully open on the 1st, 6th, 11th, 16th, 21st, and 26th of each month. On those days stalls are dense, odd jobs are plentiful, and information gets messy fast; spices, dyes, leather, tool parts, and out-of-town goods all circulate more widely. On non-market days, activity is limited to checking leftover stock, arguing old accounts, watching the sheds, and counting damaged or unsold cargo. The whole square should not feel crowded on an ordinary day.

[Key_People_Factions]
The market has no permanent manager. Merchants usually settle disputes among themselves unless a dock patrol officer has to step in. The downstream courier Ellis often appears near market days, and Mara's bookkeeping ties mean cargo discrepancies are often traced here first.

[Common_Stops]
Upper ferry approach, stall rows, bulk cargo shed, edge of the open ground, watchman's lean-to.

[Atmosphere_Interaction]
On market days the place runs from dawn to dusk, with the busiest hours before and after midday. On non-market days, wind and rumor travel farther than voices. Players can buy supplies, take short work, overhear merchant talk, or chase a cargo gap by asking who is trying to make it sound smaller than it is.`,
    old_tower_archive: `## Entity Setting -- Old Tower Archive

[Geography_Appearance]
The old tower stands in the northeast corner of town, away from the main street, surrounded by weeds and a few old locust trees. It has three stories, moss-dark stone, and barred windows at the ground level. Behind it sits a row of half-collapsed old warehouses that most people ignore. The old lookout platform on top has partly fallen in and is boarded shut.

[Functions_Activity]
The first floor is open to the public and holds town records, old contracts, transit logs, and supply lists. The second floor is sealed and needs approval. The third floor is dangerous and closed. The archive closes to the public after dusk, though Tessa sometimes stays late to keep sorting. The old warehouses behind the tower are not formal public areas, and nobody likes admitting what may once have been stored there.

[Key_People_Factions]
Tessa, an apprentice sent from another town, is currently sorting records and checking missing pages. Lucan, a scavenger, often circles the tower and claims to have picked up scraps that drifted out of it. The elders oversee the archive in name, but rarely care unless a complaint forces the matter.

[Common_Stops]
First-floor reading room, stairs to the sealed second floor, boarded third-floor entrance, outer tower wall, rear abandoned warehouse.

[Atmosphere_Interaction]
Inside, the tower smells of dust and old paper, and the dim light makes every loose page feel important. Daytime suits quiet research; after dusk, even the wind seems to warn people not to pry. Players can consult public records, talk to Tessa about the missing pages, watch Lucan outside, or judge who might slip around to the warehouse row behind the tower.`,
    mistwood_road: `## Entity Setting -- Mistwood Road

[Geography_Appearance]
Mistwood Road leaves town through the gate at the south end of the main street, slightly to the west, then crosses low hills before entering the fir-heavy mistwood. It takes about half a day on foot to reach the first inland station. The road is packed dirt, just wide enough for two carts to squeeze past each other. Tall firs hold a thin mist most of the year, and at dawn or dusk the fog often warps distance.

[Functions_Activity]
This is the town's only land route toward the inland settlements. Caravans, couriers, escorts, and walkers all rely on it. In ordinary weather it is manageable, but rain turns it muddy enough to trap wheels and worsen accidents or delays. One abandoned old materials spur still branches off from part of the road and can loop toward the outer edge of the north-bank market and the rear of the old tower, though few people still remember it.

[Key_People_Factions]
Owen knows this road well from years of caravan escort work. Vera sometimes follows it while gathering herbs and is unusually sensitive to odd fog, water changes, and roadside plant behavior. No single faction controls the road directly; if something goes wrong, the people present usually have to survive it first and report it later.

[Atmosphere_Interaction]
The silence and fog on Mistwood Road make every small irregularity feel larger. Players can escort caravans, inspect accident sites, gather herbs, follow suspect wheel tracks, or trade news with whoever happens to be resting along the route.`,
    east_farmland: `## Entity Setting -- East Farmland

[Geography_Appearance]
The farmland lies east of town, about a quarter-hour along a dirt track off the main street. The valley is open and low, with fields of grain and vegetables, stone-walled farmyards, livestock sheds, and irrigation channels spread between them. In dry periods, arguments about who gets water first become very real.

[Functions_Activity]
Several farming households raise grain and livestock for the town and the north-bank market. Beyond seasonal work, the area carries a standing local dispute: whether the farmers should fund an independent irrigation channel before the rains. Nobody wants the expense, but nobody wants to be caught short either. Routine work means feeding animals, fixing fences, and clearing channels; busy periods bring packing, weighing, and rushing goods out before market day.

[Key_People_Factions]
Vera keeps a hut on the edge of the farmland that doubles as herb room and drying shed. She treats small injuries, watches for water or livestock sickness, and is trusted by the farmers. Mara handles regular supply accounts with the farms, and Kade sometimes comes out to repair tools.

[Common_Stops]
Vera's hut, livestock shed, upper irrigation channel, temporary well, farmyard.

[Atmosphere_Interaction]
By day this area is all animal sounds and tool work; by evening it sinks into insects and distant water noise. Players can take farm work, ask Vera for medicine, help with water channels, talk to farmers about old matters, or notice a kind of tension here that differs from the town center.`,
    bridge_worksite: `## Entity Setting -- Bridge Worksite

[Geography_Appearance]
The bridge worksite covers the old bridge area north of town, not far from the dock. Temporary fencing, warning notices, dismantled timber, iron pieces, rope coils, and a rough work shed crowd the site.

[Functions_Activity]
This area is normally closed to outsiders. Bridge workers, haulers, and the occasional progress checker are the only people meant to be near it. During repairs, any speculation about deadlines, missing materials, added costs, or old iron being diverted for private profit starts here first, usually just outside the fence.

[Common_Stops]
Outside the fence, beside the material stacks, work shed entrance, by the temporary notice board.

[Atmosphere_Interaction]
Hammering and sawing dominate the day; by evening only the material watchers and loose talk about where the old parts are going remain. Players usually have to observe from outside, question people at the edge, or wait for someone willing to slip out and talk.`,
    waystone_inn: `## Entity Setting -- Resting Stone Inn

[Geography_Appearance]
The inn stands in the middle stretch of the main street, within easy reach of both the notice board and the dock. Smoked meat and old lamps hang in the front hall, while the bar is forever cluttered with cups, bottles, and account books. A few cramped guest rooms fill the upper floor.

[Functions_Activity]
Travelers, laborers, couriers, and small traders all use this place as a landing point. Daytime brings road news; evening brings drink, complaints, and rumor-trading. During bridge repairs, beds fill faster, and Jonah notices sooner than most who is arriving in a hurry and why.

[Common_Stops]
Front hall, beside the bar, corner table, stair landing.

[Atmosphere_Interaction]
The inn's warmth always comes with a little testing and listening. Players can stay the night, wait for someone, gather rumors, pick up small jobs, or catch a deeper clue in something another guest only half meant to say.`,
    notice_board: `## Entity Setting -- Town Notice Board

[Geography_Appearance]
The board stands at one side of the town-center open space, flanked by two long benches and an old wooden box where Robin collects and sorts postings. The surface is layered with fresh and fading notices, many with curled corners from too many hands.

[Functions_Activity]
Short jobs, errands, lost items, bounties, temporary notices, and market-adjacent help requests all appear here. People looking for work, people looking for spectacle, and people waiting for specific news often end up in the same ring around the board.

[Common_Stops]
Beside the notice board, beside the bench, beside the paper box.

[Atmosphere_Interaction]
This is one of the best opening anchors in town. Players can start here, take jobs, run into familiar faces, or watch who reacts too strongly to a certain kind of notice. Once a posting offers enough money, half the town is likely to hear about it quickly.`,
    grain_store: `## Entity Setting -- Grain Store

[Geography_Appearance]
The grain store sits on the east side of the main street, with sacks, scales, and empty crates often piled near the entrance. Behind the counter, the half-open ledger-room door usually lets out the sound of page turning and abacus beads.

[Functions_Activity]
This is where grain is received, shipped, recorded, and chased across old accounts. On the surface it looks like a straightforward business, but the moment cargo discrepancies, unpaid balances, mixed stock, or suspiciously cheap goods appear, Mara becomes one of the sharpest eyes in town.

[Common_Stops]
Counter, ledger-room door, loading side door.

[Atmosphere_Interaction]
People seldom come here for idle talk. Players can register clues, negotiate accounts, take loading work, or try to spot the page in a stack of cargo records that most wants to be ignored.`,
    smithy: `## Entity Setting -- Smithy

[Geography_Appearance]
The smithy stands along the eastern stretch of the main street, marked by old horseshoes and repaired ironwork by the door. The forge room is hot and close, with an anvil, tongs, and half-finished parts stacked against the walls.

[Functions_Activity]
The town depends on this place for tool repairs, axle bands, fittings, and rush metalwork. The master smith (Kade's uncle) is currently away in another town for a large commission, so Kade is running the shop alone for now. He is usually at the fire or the anvil, and he can often tell at a glance whether a piece is fresh work, reused scrap, or poor-quality imitation.

[Common_Stops]
Forge room, beside the anvil, pickup rack by the door.

[Atmosphere_Interaction]
This is the place to talk craft, inspect materials, ask where a repair came from, or judge from a few strikes whether a questionable batch of iron ought to exist at all.`,
    abandoned_warehouse: `## Entity Setting -- Abandoned Warehouse

[Geography_Appearance]
These old rooms lean against the rear wall of the tower, with half-collapsed roofing, warped doors, damp mud, and weeds thick around the base. At a distance they look long dead, but up close fresh footprints and drag marks suggest otherwise.

[Functions_Activity]
The warehouse row is not an official public area, and nobody openly admits it is still in use. That is exactly why it invites suspicion: temporary storage, hidden pickups, things waiting to be moved, and old materials or papers that do not belong in plain sight all feel as though they could pass through here.

[Common_Stops]
Under the collapsed eaves, side door, tower-side wall base.

[Atmosphere_Interaction]
Very few people come here in daylight, and after dusk the place feels wrong for any honest errand. Players who watch it are unlikely to get a full answer in one go; they are more likely to collect a few traces that should not fit together as neatly as they do.`,
    riverside_rest: `## Entity Setting -- Riverside Rest Shelter

[Geography_Appearance]
The shelter sits halfway down the stone-step path that leads from the south end of the main street to the dock, leaning against the riverside rock wall under an old waterproof canvas roof. Beneath it stand a small charcoal stove that is kept lit year-round, a few wooden benches worn smooth by use, and the river-side stone steps with a noticeable dip where people have sat for years. Children from town often hop along the rocks nearby.

[Functions_Activity]
Old Beryl runs the shelter, selling hot tea, roasted chestnuts, and a few simple snacks at prices barely meant to make money. It is not a formal shop, more like a quiet breath of space between the main street and the dock. People who stop here usually do not come to do business — they pass by to rest, take shelter from rain, sit in the sun, or listen to the old woman drift into a story about "back when the river ran higher than this."

[Key_People_Factions]
Old Beryl is the sole regular presence. She knows almost every elder in town and many people who once travelled this river, but she never picks sides. Children sometimes chase each other on the rocks nearby; laborers and couriers occasionally drop by mid-shift for a cup of water.

[Common_Stops]
Beside the tea stove, on the benches under the canvas, on the river-side stone steps, and along the shallow stones where children play.

[Atmosphere_Interaction]
Everything here moves slower than the rest of the town. Instead of shouts and hurried footsteps, you hear the river, the wind, and the hiss of the charcoal. Players can step out of the tension of their tasks for a while, drink a hot tea, and listen to Beryl drift into an old story — those stories sometimes brush surprisingly close to whatever is happening today.`,
  };

  const moduleTexts = {
    core_world_mechanics: `The player is an ordinary traveler.
Limits: the player can observe, ask questions, run errands, trade, and travel. The player cannot know secrets for free, cannot start with oversized power or equipment, and cannot directly command NPCs.
World reaction: NPCs keep their own positions and routines. Prices, rules, and passage rights come from the setting itself and cannot be overruled just by pressure or rhetoric.
Consistency: advance strictly from the world-card data. Prioritize time, place, character state, relationships, and timeline-event consistency. If multiple layers disagree about the same fact, resolve it in this order: current panel > latest snapshot before the current time > character_database / relationship_rules defaults > world_setting prose > restrained inference.
Knowledge limits: hidden causality written in the world card is not public information. NPCs may speak only from their position, experience, and current understanding.`,
    init: `Opening rules:
1. Handle time and location first. Do not begin with a long lore dump.
2. Recommended opening: start at Crossing Era 325.03.16 14:20, when Robin posts the "Market Cargo Discrepancy" bounty on the town notice board (a fast in, with several threads already in motion). If the player explicitly wants to follow the story from its earliest stages, instead start at Crossing Era 325.03.01 08:00, the day the elders first post the bridge-repair notice.
3. If the player already gives time and location, open immediately. If they also provide a backstory, accept it naturally instead of turning it into a questionnaire.
4. If the player chooses "Random Start" or says "random", start from the system-selected timeline event without announcing the random result and without asking for time or location again. The first narrative paragraph must land on that event's concrete time and place, and panel_status.location must match it. panel_status.datetime is backfilled by runtime code.
5. If the player chooses "Start with the Recommended Opening", anchor the opening to that single recommended event. If the system somehow does not resolve a unique event, still begin from this line directly rather than inventing a fake time.
6. If time or location is incomplete, ask only for the missing piece in-world with one or two natural lines.
7. Keep the backstory hook light. A natural prompt like "Are you here to find someone, carry a message, earn silver, or because something delayed you?" is enough, and the player may ignore it.
8. If the player gives a backstory, connect it to existing NPCs, locations, or clues first. If not, begin as an ordinary traveler without forcing more setup.
9. The opening scene must include at least one NPC the player can talk to. No empty scene plus long environmental prose.`,
    narrative_base: `Narrative style:
- Keep the mystery light and steady. A turn can end on a small hook, but not every turn needs a dramatic twist.
- Prioritize human interaction. NPC dialogue should carry attitude and emotion, not just data.
- Avoid instruction-manual phrasing. Let the scene imply what can be done next.
- Try to leave the player with at least one thing they can do right away.
- Keep information asymmetric. NPCs only share what they have reason to share. Key information should come through trust, exchange, coincidence, or being on the scene.
- Do not let NPCs speak hidden truths just because the model can see the whole card. Rumor, suspicion, eyewitness detail, and actual truth must stay distinct.
- Important clues may collide naturally, but do not assemble the entire answer too early just because the model knows the map.
- Let plot lines cross when time, place, and people overlap. Do not reduce the story to clearing one bulletin-board quest after another.
- Do not default into harem, idolized-protagonist, domination, humiliation, or romance-first tones.
- Drive play through social ties, choices, situation shifts, clues, money, and staying or leaving.
- Keep roles and usefulness balanced across the cast.`,
    time_protocol: `Time progression:
- Casual conversation and observation usually advance 10 to 30 minutes.
- Work, travel, or waiting may advance half a day to several days when justified.
- Time changes must affect NPC state and event visibility: stalls that exist by day should close at night; the north-bank market is fully open only on the 1st, 6th, 11th, 16th, 21st, and 26th of each month; on non-market days only a few merchants and watchmen remain.
- Unattended matters keep moving forward. If the player delays near a critical date, show deterioration in the scene: clues changing hands, prices shifting, conflicts worsening, or other people acting first.
- Runtime code backfills panel_status.datetime after each advance. The narrative is responsible only for estimating elapsed time and keeping event visibility coherent.
- If the current date moves beyond the written March 325 event window, return to the town's baseline routine and keep only consequences the player has triggered or that have already spread publicly.
- Post-window hook: the merchant company arriving in early April 325 is the natural next-stage event. Their arrival further strains dock and inn capacity and forces the elders to take a public stance on passage terms; if the smuggling network has not yet been exposed, their arrival sets off a larger argument over cargo discrepancies and iron rumors. Marek will choose to disappear or change identity around the time they arrive.
- Do not skip more than three days in a single turn without a clear reason unless the player explicitly asks to wait.`,
    economy: `Currency: silver.
Reference prices:
- bread: 1 to 2 silver
- a bowl of hot soup with coarse grain: 3 silver
- inn bed for one night: 5 to 8 silver
- one-way ferry ticket in ordinary conditions: 10 silver
- one-way ferry ticket in flood season: 15 to 18 silver
- day labor hauling cargo or watching a stall: 12 to 15 silver
- local errand delivery: 5 to 8 silver
- one-way Mistwood escort: 30 to 50 silver
Dynamic rules:
- During bridge repairs, inn beds often rise to 10 to 12 silver because space tightens.
- On the day before a market day, local errand prices usually rise by about a third as merchants scramble to prepare stock.
- If the cargo-discrepancy issue remains unresolved by the next market day, some merchants reduce incoming goods, which also cuts hauling and odd-job opportunities.
Newcomer safety net:
- A newly arrived traveler usually still has 15 to 30 silver on hand.
- Even when money is tight, the Resting Stone can sometimes make room for a cheap common bed.
- The notice board usually carries one or two low-barrier jobs.
Payment rules:
- NPCs do not extend credit to strangers.
- Larger deals may use a deposit first and settlement later.
- Theft and fraud can bring patrol consequences.`,
    npc_gen: `panel_npc rules:
- Every field must stay short, precise, and stable. Prefer tag-like values with "/" separators and keep them to three words or fewer.
- NEW may include a full profile. UPDATE may change only runtime state fields and may not change gender, origin, birthday, id, or name.
- NEW_PREDEFINED requires only id; name and fixed profile fields are backfilled from the predefined database.
- gender: use a short stable value such as Female / Male / Unknown. If the narrative does not support it, omit it rather than inventing it.
- origin: one brief public background line such as "dock local" or "apprentice from another town". Omit if unknown.
- birthday: when known, always use the format "Crossing Era YYY.MM.DD". When unknown, use null directly.
- msg_reply_tone: describe stable speaking style, not temporary mood.
- personality: keep to two or three trait tags.
- appearance: write one or two most visible physical traits.
- clothing: write concrete current clothing, not vague judgments.
- faction and role should prefer existing organizations, location roles, and task language from the world card rather than invented titles.
- current_goal should describe what the NPC is doing now or about to do next. character_database.current_goal is only the opening default.
- cognitive_state should describe who the character currently thinks they are, such as "ticket clerk at the dock" or "archive apprentice chasing old accounts".
- cognitive_state must not summarize plot truth, the NPC's attitude toward the player, or temporary emotion shifts.
- Do not stuff long sentences into panel fields. Do not output romance-forward or sexualized content.`,
  };

  const moduleMeta = {
    core_world_mechanics: {
      description: 'Defines player limits, world reaction, truth priority, and consistency rules.',
      when_to_call: 'Always active.',
      avoid_when: 'Never.',
      input_focus: 'Player action, known world facts, current relationships, and location rules.',
      expected_output:
        'Narration that stays inside the ordinary-traveler premise and the established world facts.',
    },
    init: {
      description: 'Controls the opening so the player lands in a playable scene quickly.',
      when_to_call: 'Turn 1 only.',
      avoid_when: 'Do not use once ordinary play is already underway.',
      input_focus: 'Whether the player already supplied time, location, and any short background.',
      expected_output:
        'An opening scene with concrete time, location, at least one talkable NPC, and an immediate action path.',
    },
    narrative_base: {
      description: 'Defines the baseline scene style, clue pacing, and interaction priorities.',
      when_to_call: 'Use during narrative turns as needed.',
      avoid_when: 'Skip for pure system operations.',
      input_focus: 'Scene tone, human interaction, clue leakage risk, and immediate action space.',
      expected_output:
        'Grounded narrative with light suspense, strong NPC presence, and no premature reveal.',
    },
    time_protocol: {
      description: 'Controls how time passes and how that changes availability and event visibility.',
      when_to_call: 'Whenever an action clearly consumes time.',
      avoid_when: 'Avoid forced jumps during immediate short dialogue.',
      input_focus: 'Action duration, current date, NPC routines, market-day rules, and event timing.',
      expected_output: 'Consistent time progression reflected in state and scene availability.',
    },
    economy: {
      description: 'Defines money flow, price anchors, fallback survival options, and payment rules.',
      when_to_call:
        'Use when buying, selling, earning, paying, hiring, compensation, or shortages matter.',
      avoid_when: 'Do not force it into scenes with no money flow.',
      input_focus: 'Prices, wages, season, shortages, and settlement rules.',
      expected_output: 'Grounded prices and consequences that fit the town economy.',
    },
    npc_gen: {
      description: 'Constrains how NPC panel updates are generated and displayed.',
      when_to_call: 'When a new NPC appears or a known NPC state clearly changes.',
      avoid_when: 'Skip during pure environment description.',
      input_focus: 'Structured NPC information that is visible in the narrative.',
      expected_output: 'Short and stable panel_npc fields suitable for direct display.',
    },
  };

  const locationNames = {
    sanchadu_town: 'Sanchadu Town',
    ferry_dock: 'Ferry Dock',
    north_market: 'North Bank Market',
    old_tower_archive: 'Old Tower Archive',
    mistwood_road: 'Mistwood Road',
    east_farmland: 'East Farmland',
    bridge_worksite: 'Bridge Worksite',
    waystone_inn: 'Resting Stone Inn',
    notice_board: 'Town Notice Board',
    grain_store: 'Grain Store',
    smithy: 'Smithy',
    abandoned_warehouse: 'Abandoned Warehouse',
    riverside_rest: 'Riverside Rest Shelter',
  };

  const spotNames = {
    'Vera 小屋': "Vera's hut",
    '一层阅档区': 'First-floor reading room',
    '三层封板口': 'Boarded third-floor entrance',
    '上游引水渠': 'Upper irrigation channel',
    '临时井边': 'Temporary well',
    '临时告示牌前': 'By the temporary notice board',
    '二层封存楼梯口': 'Stairs to the sealed second floor',
    '侧门口': 'Side door',
    '候船长椅区': 'Waiting benches',
    '公告板旁': 'Beside the notice board',
    '农户院落': 'Farmyard',
    '前厅': 'Front hall',
    '吧台旁': 'Beside the bar',
    '售票棚': 'Ticket booth',
    '售票棚外': 'Outside the ticket booth',
    '围栏外': 'Outside the fence',
    '塌檐下': 'Under the collapsed eaves',
    '塔后库房门口': 'Rear warehouse doorway',
    '塔后废弃库房': 'Rear abandoned warehouse',
    '塔外墙根': 'Outer tower wall',
    '大宗货栈木棚': 'Bulk cargo shed',
    '学塾门口': 'Schoolhouse entrance',
    '工棚门口': 'Work shed entrance',
    '排队区': 'Queue line',
    '摊位区': 'Stall rows',
    '收纸木箱旁': 'Beside the paper box',
    '旅店「歇脚石」前厅': 'Front hall of the Resting Stone inn',
    '旅店前厅': 'Inn front hall',
    '旅店角落': 'Inn corner',
    '旧运料岔路': 'Old materials spur',
    '材料堆旁': 'Beside the material stacks',
    '柜台': 'Counter',
    '楼梯口': 'Stair landing',
    '歇脚点': 'Roadside rest stop',
    '河道公所告示牌': 'River office notice board',
    '浮桥入口': 'Floating pier entrance',
    '渡口上方入口': 'Upper ferry approach',
    '炉间': 'Forge room',
    '牲畜棚': 'Livestock shed',
    '看场人休息棚': "Watchman's lean-to",
    '空场边缘': 'Edge of the open ground',
    '粮行柜台': 'Grain-store counter',
    '装卸侧门': 'Loading side door',
    '西段弯道': 'West bend',
    '角落散桌': 'Corner table',
    '账房门口': 'Ledger-room door',
    '货物暂存区': 'Cargo holding area',
    '铁匠铺炉间': 'Smithy forge room',
    '铁砧旁': 'Beside the anvil',
    '镇中心公告板旁': 'Beside the town-center notice board',
    '长凳边': 'Beside the bench',
    '门口待取架': 'Pickup rack by the door',
    '靠塔那面墙根': 'Tower-side wall base',
    '茶炉边': 'Beside the tea stove',
    '棚下长凳': 'Benches under the canvas',
    '河边石阶': 'River-side stone steps',
    '孩子跳石的浅滩边': 'Shallow stones where children play',
    '塔后废弃库房（傍晚后）': 'Rear abandoned warehouse (after dusk)',
  };

  const eventTranslations = {
    evt_001: {
      characters: 'Town Elders',
      content:
        'The town elders post a bridge-repair notice in the town center: the ferry bridge needs structural work before the rainy season, likely for two to three weeks. During repairs, river crossings depend on the ferry, and the fare stays unchanged for now.',
    },
    evt_002: {
      characters: 'Mina / Sera',
      content:
        'On the third day of repairs, ferry traffic surges and the queue stretches out. During patrol, Sera catches people making illegal small-boat crossings and reports it to the river office. Mina complains that the ticket booth is understaffed and starts paying attention to people who keep showing up with unclear cargo slips.',
    },
    evt_003: {
      characters: 'Sera / Town Elders',
      content:
        'The river office approves a temporary fare increase of 5 silver during the repairs. Some residents and merchants object, but Sera enforces the order. Mina posts the fare-adjustment notice at the booth while the elders start privately discussing how to suppress merchant anger before it spreads.',
    },
    evt_004: {
      characters: 'Market Vendors / Mara',
      content:
        'Market day. Vendors on the north bank report that recent deliveries do not match their manifests: one shipment listed 12 crates of dry goods but only 10 arrived, and several suspiciously cheap iron items were mixed in. Mara checks the books and finds the discrepancy does not begin at the grain store, suggesting that someone is opening crates and swapping cargo somewhere between the dock and the market.',
    },
    evt_005: {
      characters: 'Tessa',
      content:
        'While sorting second-floor transit records in the old tower, Tessa discovers that 17 consecutive pages covering Crossing Era 320 to 322 were torn out, exactly across a key period tied to the old ferry reconstruction. When she reports it, the reply is vague: repair the catalog and do not make noise. For the first time, Tessa suspects the people who sent her may care more about who notices the gap than about fixing it.',
    },
    evt_006: {
      characters: 'Owen / Caravan',
      content:
        'On the inland return through Mistwood Road, Owen and the caravan hit heavy fog. One wagon slips into a ditch and two crates of cloth are ruined by damp, delaying the caravan by a day and a half. Owen suspects a roadside marker may have been moved, though he cannot yet tell whether it was a prank or deliberate misdirection.',
    },
    evt_007: {
      characters: 'Jonah / Robin',
      content:
        'At the inn, Jonah hears guests say that bridge workers quietly sold old iron taken from the bridge to outside scrap buyers, and that the same buyer also picked up several crates of cheap hardware. Jonah remembers handling a few suspiciously cheap goods at his inn in the past. He does not say everything outright, but he passes a cautious version of the rumor to Robin, who notes it down without posting it yet.',
    },
    evt_008: {
      characters: 'Vera / Farmers',
      content:
        'Farmers on the east side report livestock with unexplained diarrhea. After checking them, Vera judges that muddy contamination washed down from upstream has fouled the water source. She recommends switching to well water for now, though that will require smithy help to repair a pump. The farmers begin to worry that recent strange cargo movement and river debris may be tying several problems together.',
    },
    evt_009: {
      characters: 'Robin',
      content:
        'Three short-term jobs appear on the notice board: dock hauling for 12 silver a day, old-tower sorting help for 10 silver plus lunch, and temporary farm labor for 15 silver if the worker brings gloves. Robin reminds job-takers to confirm with the employer first while quietly watching which strangers ask about the dock, the tower, and the road all at once.',
    },
    evt_010: {
      characters: 'Tessa / Lucan',
      content:
        'Lucan wanders near the old tower claiming he found a torn old paper scrap in a crack in the outer wall. It bears a blurred seal and numbers, and he hints it may be part of a transfer list rather than a simple note. Tessa thinks it may match the missing records, but Lucan wants 20 silver and says he will sell it to passing outsiders in two or three days if no one here pays first.',
    },
    evt_011: {
      characters: 'Mina / Ellis',
      content:
        'The courier Ellis arrives from the downstream port town with word that similar cargo-count complaints are being filed there too, including suspiciously cheap iron fittings and hardware like the ones appearing around the crossing. Mina records the batch details and asks Ellis to carry the information over to Mara for comparison.',
    },
    evt_012: {
      characters: 'Mara / Market Vendors',
      content:
        'Non-market day. Mara takes the ledgers to the north-bank cargo sheds and leftover-stock stalls to compare the previous round of manifests. She finds at least three stalls listing the same middleman as their source, even though that person has never registered a transit permit in Sanchadu. Worse, two batches of leftover cheap iron pieces carry casting marks close to the repair iron commonly seen in town. Mara begins to suspect a deliberate route for bypassing registration, swapping goods, and fencing them.',
    },
    evt_013: {
      characters: 'Kade / Owen',
      content:
        "Owen asks Kade to repair the bent axle band damaged in the Mistwood ditch accident. Kade says the iron is poorer than it should be, more like reused stock than newly forged metal. Stranger still, its casting mark matches the cheap hardware Mara has been tracing in the market. Owen starts to suspect that the road accident, the cargo discrepancy, and the sale of old bridge iron may be colliding.",
    },
    evt_014: {
      characters: 'Iris',
      content:
        'While covering lessons, Iris hears students repeating that people have been moving in and out of the abandoned warehouse behind the old tower around dusk. She is not sure whether it is just Lucan scavenging, but the rumor comes from multiple student eyewitness stories, and the figure they saw was "much taller than Lucan" and seemed to be carrying something heavy.',
    },
    evt_015: {
      characters: 'Owen / Vera',
      content:
        'Owen goes back to inspect the marker suspected of being moved, and Vera joins him. Near it, Vera finds fresh wheel tracks narrower than a standard cargo cart, the sort of tracks a small wagon might leave if it were deliberately avoiding registration at the crossing. The tracks turn away from the proper route and head toward the abandoned materials spur that can approach both the outer edge of the north-bank market and the warehouse behind the old tower.',
    },
    evt_016: {
      characters: 'Sera',
      content:
        'Sera rules on a ferry-fare dispute after an outside merchant refuses to pay the increased amount, arguing the change was not posted far enough in advance. After checking the river-office procedure, Sera admits the posting process was flawed and temporarily allows settlement at the old rate. Once the story spreads along the dock, some elders privately start talking about negotiating special passage terms with the large merchant company expected next month. Sera says openly that she will not endorse that approach.',
    },
    evt_017: {
      characters: 'Jonah / Iris',
      content:
        'Through inn guests, Jonah learns that a larger merchant company plans to pass through town next month on the way inland. If the bridge is still unfinished, all that cargo will have to rely on the ferry, driving up pressure on the dock, the inn, and storage. Iris suggests giving the news to Robin for the notice board, while Robin worries that if the cargo discrepancy and fare dispute are still unresolved, the merchant company will expose every problem at once.',
    },
    evt_018: {
      characters: 'Tessa',
      content:
        'While working late over first-floor records, Tessa finds a maintenance log from Crossing Era 320. It notes that "old goods under the tower" were moved to the abandoned warehouse during the old ferry reconstruction and that the dismantled ironwork was supposed to be accompanied by a separate handover list. The page number for that list falls inside the range of torn records. Tessa begins to suspect that the missing pages, the warehouse traffic, and the rumors of privately sold old iron all point back to the same unresolved account.',
    },
    evt_019: {
      characters: 'Vera / Farmers',
      content:
        "Vera's temporary well-water solution works and the livestock begin to recover. Even so, the farmers worry that upstream water quality will worsen once the rains return and ask whether the town can help fund an independent irrigation channel. Vera agrees to help write a proposal to the elders, while warning that if it is delayed much longer, the next losses will hit not only animals but also the town's grain supply.",
    },
    evt_020: {
      characters: 'Robin / Mara',
      content:
        'Robin posts a bounty on the town notice board asking for leads on the "Market Cargo Discrepancy" and directs people to register with Mara at the grain store. The damaged merchants jointly fund an 80-silver reward. Robin has also heard privately that if nobody offers an answer before the next market day, those merchants plan to confront haulers and middlemen at the dock in person.',
    },
  };

  const characterTranslations = {
    mina: {
      gender: 'Female',
      origin: 'Local to the crossing, from a family that has worked the dock for three generations.',
      default_cognitive_state: 'Ticket clerk at the ferry booth',
      msg_reply_tone: 'Brisk, efficient, with the occasional dock joke for regulars.',
      personality: 'Direct / warm / impatient with dithering',
      appearance: 'Short brown hair / sun-darkened / strong arms',
      clothing: 'Dock work vest / rolled-sleeve linen shirt / ticket clip at the waist',
      faction: 'River Office',
      role: 'Ticket Clerk',
      current_goal: 'Keep order at the ticket booth',
      routine:
        "From dawn to dusk she moves between the ticket booth and the queue line, then watches the day's final tickets and cargo after the last run.",
    },
    jonah: {
      gender: 'Male',
      origin: 'Moved in from elsewhere and took over the inn fifteen years ago.',
      default_cognitive_state: 'Innkeeper of the Resting Stone',
      msg_reply_tone:
        'Talkative, often chatting while wiping cups; noticeably vaguer when supply sources come up.',
      personality: 'Smooth / hospitable / good with accounts',
      appearance: 'Heavyset / full beard / deep smile lines',
      clothing: 'Apron / thick cotton shirt / sleeves rolled to the elbows',
      faction: 'None',
      role: 'Innkeeper',
      current_goal: 'Look after travelers / listen for rumors',
      routine:
        'He spends most of the day in the front hall and behind the bar, then keeps books and listens to traveler talk after dusk.',
      private_notes:
        'He has quietly held small dubious shipments for trusted regulars before, which makes him extra cautious around cargo sources and old accounts.',
    },
    robin: {
      gender: 'Male',
      origin: 'Raised in town, originally trained as a carpenter before changing trades.',
      default_cognitive_state: 'Notice-board keeper in the town center',
      msg_reply_tone: 'Brief, practical, and occasionally dryly funny.',
      personality: 'Steady / exacting / not fond of idle chatter',
      appearance: 'Lean and tall / close-cropped hair / old wood splinters in the fingers',
      clothing: 'Work vest / rough trousers / tool pouch at the belt',
      faction: 'None',
      role: 'Notice-Board Keeper',
      current_goal: 'Sort postings / assign odd jobs',
      routine:
        'Mornings go to sorting notices and errands, while afternoons are often spent near the board watching who reacts too strongly to what.',
    },
    tessa: {
      gender: 'Female',
      origin: 'Archive apprentice from another town, sent to sort the old tower records.',
      default_cognitive_state: 'Apprentice assigned to sort the archive',
      msg_reply_tone:
        'Polite but slightly tense; she becomes more focused and talkative when records are involved, then hesitates when speaking about the people who sent her.',
      personality: 'Serious / curious / easily tense',
      appearance: 'Round face / dark braids / thin-rim glasses',
      clothing: 'Grey archive apprentice robe / ink-stained cuffs / canvas satchel',
      faction: 'Old Tower Archive',
      role: 'Archive Apprentice',
      current_goal: 'Check the missing-page records',
      routine:
        'She spends most days registering, sorting, and patching catalogs between the first floor and the second-floor stair, sometimes staying after dusk to keep working.',
      private_notes:
        'She was also told to quietly check a batch of missing old records, and she does not fully trust the people who sent her.',
    },
    vera: {
      gender: 'Female',
      origin: 'Raised near Mistwood Road and largely self-taught in herbal work.',
      default_cognitive_state: 'Herbalist serving the east-side farms',
      msg_reply_tone: 'Slow and precise, with the occasional plant metaphor.',
      personality: 'Steady / careful / independent',
      appearance: 'Long black hair in a low tie / deeper complexion / herb stains on her hands',
      clothing: 'Linen apron / many-pocketed vest / cloth boots',
      faction: 'None',
      role: 'Herbalist',
      current_goal: 'Mix remedies / watch for rainy-season sickness',
      routine:
        'She moves between her hut, the livestock sheds, and the irrigation channel, checking water and symptoms more often than usual before the rains.',
    },
    sera: {
      gender: 'Female',
      origin:
        'Seconded from the river office and stationed at the crossing for two years, in a strained working relationship with the town elders.',
      default_cognitive_state: 'River patrol officer assigned to the crossing',
      msg_reply_tone:
        'Formal, concise, and impersonal; more severe whenever the elders come up.',
      personality: 'Rigorous / fair / unwilling to yield',
      appearance: 'Medium build / short black hair / very upright posture',
      clothing: 'River-office coat / arm badge / patrol token at the belt',
      faction: 'River Office',
      role: 'Patrol Officer',
      current_goal: 'Inspect illegal ferry movement',
      private_notes:
        "Has clashed openly with Elder Brun over a private deal to bypass the river office for special passage terms — the cost would have landed on the town accounts, not on her. Refuses to cover the elders' political debts, but isn't trying to break with them outright.",
      routine:
        'By day she patrols short loops between the dock, the bridge worksite, and the town center, lingering longer at the dock when water rises or arguments begin.',
    },
    owen: {
      gender: 'Male',
      origin: 'From an inland town and six years into caravan escort work.',
      default_cognitive_state: 'Caravan guard on the inland route',
      msg_reply_tone:
        'Easygoing and fond of road stories, polite to strangers without becoming too warm too quickly.',
      personality: 'Easygoing / alert / values trust',
      appearance: 'Broad shoulders / light brown short hair / old scar on the left arm',
      clothing: 'Leather bracers / travel cloak / heavy road boots',
      faction: 'None',
      role: 'Escort Guard',
      current_goal: 'Wait for caravan news / pick up escort work',
      routine:
        'When employed he moves between the road and the caravan. When idle he usually waits at the inn or smithy for news and repairs.',
    },
    kade: {
      gender: 'Male',
      origin: "Nephew of the town smith, raised helping in the shop.",
      default_cognitive_state: 'Apprentice working at the smithy',
      msg_reply_tone: 'Quiet at first, but eager once tools or metal are the topic.',
      personality: 'Reserved / deft / stubborn',
      appearance: 'Young build / messy black hair / burn-callused hands',
      clothing: 'Leather apron / sweat shirt / thick grimy gloves',
      faction: 'Smithy',
      role: 'Smith Assistant',
      current_goal: 'Rush through repair work',
      routine:
        'He spends most of the day at the fire and the anvil, and in busy periods gets called out to the farms or dock to inspect broken ironwork.',
    },
    iris: {
      gender: 'Female',
      origin: "Daughter of a local teacher who sometimes fills in for lessons herself.",
      default_cognitive_state: 'Temporary teacher in town',
      msg_reply_tone:
        'Talkative and quick, fond of pressing for details, sometimes before she has fully thought them through.',
      personality: 'Lively / nosy / bluntly sincere',
      appearance: 'Short reddish-brown hair / freckles / expressive face',
      clothing: 'Cotton dress / small shoulder bag / cloth shoes',
      faction: 'None',
      role: 'Substitute Teacher',
      current_goal: 'Post notices / gather news',
      routine:
        'She bounces between lessons, errands, and rumor-hunting, preferring places where many people gather and speak carelessly.',
    },
    lucan: {
      gender: 'Male',
      origin: 'Unclear; he claims to make a living scavenging around the old tower.',
      default_cognitive_state: 'Scavenger around the old tower',
      msg_reply_tone: 'Slippery, suggestive, and fond of half-finished hints.',
      personality: 'Sly / suspicious / secretive',
      appearance: 'Thin frame / messy gray hair / flickering eyes',
      clothing: 'Patched coat / old scarf / bulging cloth bag',
      faction: 'None',
      role: 'Scavenger',
      current_goal: 'Sell old-tower gossip',
      routine:
        'He drifts around the tower by day, then tests the warehouse row or the inn at dusk to see who might pay for information.',
    },
    mara: {
      gender: 'Female',
      origin: "A distant relative of the grain-store owner, brought in to help manage the books.",
      default_cognitive_state: 'Bookkeeper watching the grain-store accounts',
      msg_reply_tone:
        'Exact with numbers and dry in tone, especially serious about debts, repayments, and suspiciously cheap stock.',
      personality: 'Precise / cool-headed / unsentimental',
      appearance: 'Narrow face / black hair in a high knot / habitual frown',
      clothing: 'Dark long overshirt / sleeve guards / abacus at the waist',
      faction: 'Grain Store',
      role: 'Bookkeeper',
      current_goal: 'Audit accounts / chase outside debts',
      routine:
        'She watches the counter and incoming stock in the morning, then buries herself in the ledger room after midday and heads to the market or notice board when something does not add up.',
      private_notes:
        'She also chases several murky outside accounts in town and is especially alert to cheap supply sources, leftover stock, and mixed manifests.',
    },
    ellis: {
      gender: 'Male',
      origin: 'Member of the downstream port-town messenger guild.',
      default_cognitive_state: 'Courier from the downstream port town',
      msg_reply_tone:
        'Fast and dense with information, often introducing something new with "one more thing."',
      personality: 'Quick / talkative / never still',
      appearance: 'Medium build / curly hair / road-darkened wheat skin',
      clothing: 'Courier vest / many-pocket satchel / light running shoes',
      faction: 'Messenger Guild',
      role: 'Courier',
      current_goal: 'Deliver messages / spread news',
      routine:
        'He runs between the north bank and the dock most often around market days, and usually carries back extra news from other towns when on deliveries.',
    },
    marek: {
      gender: 'Male',
      origin: 'Claims to be a broker sent from a downstream port-town trading house; never registered in Sanchadu.',
      default_cognitive_state: 'Broker working for an out-of-town trading house',
      msg_reply_tone:
        "Carefully courteous to everyone; the more pointed the question, the more politely he answers around it without ever raising his voice.",
      personality: 'Polite / cool-headed / calculating',
      appearance: 'Medium build / neatly cut grey hair / mild eyes that rarely shift',
      clothing: 'Dark merchant robe / a plain copper bracelet / two thick ledgers at the belt',
      faction: 'Out-of-town trading house (claimed)',
      role: 'Broker',
      current_goal: 'Move the last of this old-iron stock through',
      private_notes:
        "He is one of the actual operators of the network that bypasses Sanchadu's registration, using a \"broker\" identity to spread the books across different stalls. Under questioning he will play the bewildered victim and quietly hint that someone else dragged him into it; when pressed harder he is willing to push Lucan or some hauler forward as a fall guy. He never confronts the player or any NPC openly — every conflict is handled with words, deflection, and getting someone else to do the dirty part.",
      routine:
        'By day he circulates around the bulk-cargo sheds at the north-bank market checking on leftover stock; after dusk he slips around behind the old tower to a back warehouse to watch a pickup, and occasionally takes meetings with buyers in a corner of the inn. He never sleeps where he meets people and keeps his real lodging unclear.',
    },
    beryl: {
      gender: 'Female',
      origin: 'Born in Sanchadu; ran the river with her late husband when younger, then stayed on alone keeping the riverside shelter.',
      default_cognitive_state: 'Old keeper of the riverside rest shelter',
      msg_reply_tone:
        'Slow and unhurried, fond of tying whatever is happening now to some old story; never rushed, and always gentler with children.',
      personality: 'Warm / well-traveled / refuses to take sides',
      appearance: 'Short stature / silver hair tied with cloth / deep wrinkles but bright clear eyes',
      clothing: 'Indigo coarse-cloth dress / old wool shawl / apron pocket full of hard candy',
      faction: 'None',
      role: 'Riverside shelter keeper',
      current_goal: 'Tend the small shelter and keep tea hot / save candy for the town children',
      routine:
        'She lights the stove and brews tea at first light, hosts whoever passes by during the day, often sits on the river-side stone steps in the afternoon to watch the water, and packs up at dusk.',
    },
  };

  const relationTextMap = {
    '熟客/友好': 'Regular customer / friendly',
    '老街坊/友好': 'Old neighbors / friendly',
    '看着长大的/长辈关怀': 'Watched them grow up / protective elder affection',
    '邻居/务实来往': 'Neighbors / practical dealings',
    '邻居/互相帮忙': 'Neighbors / help each other',
    '年龄相近/偶尔聊天': 'Similar age / occasional chats',
    '年龄相近/好奇对方工作': "Similar age / curious about the other's work",
    '路上认识/互相尊重': 'Met on the road / mutual respect',
    '账目往来/互相提防': 'Account dealings / mutually wary',
    '账目往来/各留心眼': 'Account dealings / both guarded',
    '账目往来/怀疑他的便宜货': 'Account dealings / suspicious of his cheap stock',
    '公务对接/公事公办': 'Official coordination / strictly business',
    '信息交换/公事': 'Information exchange / official business',
    '公务来往/尊重': 'Work dealings / respectful',
    '常见面/投缘': 'See each other often / get along',
    '修工具时打交道/友善': 'Tool-repair dealings / friendly',
    '偶尔来买铁料/公事': 'Occasional iron purchases / business',
    '偶尔合作/互相尊重': 'Occasional collaborators / mutual respect',
    '修车找他/信任手艺': 'Goes to him for wagon repairs / trusts his skill',
    '常客/欣赏对方见识': 'Regular customer / respects his know-how',
    '被警惕/觉得她太死板': 'Watched warily / thinks she is too stiff',
    '偶尔对账/中性': 'Occasional account checks / neutral',
    '送信对接/公事': 'Message handoff / official business',
    '配合但有微词': 'Cooperative but resentful',
    '私下交底': 'Shares things in private',
    '警惕/不信任': 'Guarded / distrustful',
    '怀疑他知道更多但不敢轻信': 'Suspects he knows more / does not trust him fully',
    '请他修铁箍，也从他口中听到铁件标记的怪事':
      'Asked him to repair the axle band / also heard about the strange iron marks from him',
    '怀疑他知道进货来源却不明说':
      'Suspects he knows the supply source but refuses to say it plainly',
    '需要他帮忙跨镇核查': 'Needs him to help verify records across towns',
    '林道同行后信任增加，也开始把水路问题和林道怪事一起想':
      'Trusted more after traveling the road together / now links the water issue with the road oddities',
    '知道她想要纸片，打算借她试出还有谁在找旧账':
      'Knows she wants the paper scrap / plans to use her to see who else is digging into the old account',
    '替受损商贩张罗悬赏/合作加深':
      'Organizing the bounty for the harmed merchants / cooperation deepened',
    '帮她跑跨镇核查/配合度提高':
      'Helping her with cross-town verification / better cooperation',
    '修铁箍时聊到铁件标记的怪事/信任加深':
      'Talked about the odd iron marks while repairing the band / trust deepened',
    '从小认识/亲切': 'Known since childhood / warm',
    '尚未正式接触/但隐约觉得货差与缺页可能是同一桩旧账':
      'No direct contact yet / but suspects the cargo gap and the missing pages may be the same old account',
    '在旅店角落出没/Jonah 知道他但不愿多搭话':
      'Hangs around the inn corner / Jonah knows him but avoids chatting',
    '尚未正式接触/但都在追各自的旧账':
      'No direct contact yet / but each is chasing their own old account',
    '偶尔差遣他探消息/给钱办事，必要时随时弃用':
      'Occasionally hires him to fish for information / pays per task and ready to drop him at any time',
    '对方知道自己收赃货/双方都装作不知更安全':
      'The other knows he handles dirty stock / both pretend not to, which is safer',
    '感觉到她已经盯上自己/会礼貌回避正面碰头':
      'Senses she has him in her sights / politely avoids any face-to-face meeting',
    '看着她长大/有时塞糖给她':
      'Watched her grow up / occasionally slips her a piece of candy',
    '老街坊/多年互相照应':
      'Old neighbors / have looked after each other for years',
    '公告板偶尔来取告示/亲切':
      'Comes by occasionally for notices / warm',
    '码头一来一往多年/熟脸':
      'Years of dock encounters / a familiar face',
    '码头来回常碰到/熟脸':
      'Often crosses paths around the dock / a familiar face',
    '知道他收赃货/双方都装作不熟更安全':
      'Knows he handles dirty stock / both pretend not to know, which is safer',
    '偶尔在旅店角落见到/不主动招呼':
      'Sometimes spots him in the inn corner / does not greet him first',
    '取告示路过时打招呼/亲切':
      'Says hello in passing when fetching notices / warm',
    '从小被她照顾/有时坐在棚下听故事':
      'Looked after by her since childhood / sometimes sits under the canvas listening to stories',
    '偶尔被他差遣探消息拿钱办事/也摸不准他底细':
      'Occasionally runs errands for him for pay / never quite figures out who he is',
    '未注册的中间商/正在悄悄追查':
      'An unregistered broker / quietly tracing him',
  };

  const timelineStateMap = {
    '渡口票棚的日常售票员': 'Everyday ticket clerk at the dock booth',
    '忙于涨价风波的售票员': 'Ticket clerk busy with the fare-hike fallout',
    '盯着怪货单的售票员': 'Ticket clerk watching the strange cargo manifests',
    '歇脚石的旅店老板': 'Innkeeper of the Resting Stone',
    '怕惹上旧账的旅店老板': 'Innkeeper worried about being dragged into old accounts',
    '想扩容揽客的旅店老板': 'Innkeeper hoping to expand for more guests',
    '被派来整理档案的学徒': 'Apprentice sent to sort the archive',
    '盯着缺页记录的档案学徒': 'Archive apprentice focused on the missing pages',
    '追查旧账的档案学徒': 'Archive apprentice chasing the old account',
    '跑内陆线的车队护卫': 'Caravan guard on the inland route',
    '盯着林道事故的车队护卫': 'Caravan guard fixated on the road accident',
    '追查可疑车辙的车队护卫': 'Caravan guard tracking suspicious wheel ruts',
    '驻渡口办差的河道巡守': 'River patrol officer posted at the crossing',
    '加紧查私渡的河道巡守': 'River patrol officer cracking down on illegal crossings',
    '不肯替长老会背锅的巡守': 'Patrol officer refusing to take the blame for the elders',
    '盯商团通行的河道巡守': "Patrol officer watching for the merchant company's passage",
    '替粮行盯账的记账员': 'Bookkeeper watching the grain-store accounts',
    '追查货差的记账员': 'Bookkeeper tracing the cargo discrepancy',
    '盯未注册中间商的记账员': 'Bookkeeper watching the unregistered middleman',
    '准备收紧旧账的记账员': 'Bookkeeper preparing to tighten the old accounts',
    '在东侧农庄配药的草药师': 'Herbalist mixing remedies at the east farms',
    '盯水质和病症的草药师': 'Herbalist watching water quality and symptoms',
    '催着递提案的草药师': 'Herbalist pressing to submit the proposal',
    '在旧塔附近拾荒的拾荒人': 'Scavenger around the old tower',
    '拿纸片待价而沽的拾荒人': 'Scavenger holding a paper scrap for the right price',
    '镇中心的公告板管理员': 'Notice-board keeper in the town center',
    '贴出悬赏告示的公告板管理员': 'Notice-board keeper posting the bounty notice',
    '下游港镇来的信差': 'Courier from the downstream port town',
    '帮忙跨镇核查的信差': 'Courier helping with cross-town verification',
    '在铁匠铺学手艺的助手': 'Smithy assistant learning the craft',
    '发现铁件标记异常的铁匠助手': 'Smithy assistant who noticed the strange iron marks',
    '镇上的代课员': 'Substitute teacher in town',
    '被学生传闻勾起警觉的代课员': 'Substitute teacher made alert by student rumors',
  };

  const fieldDescTranslations = {
    country: 'Prefer an established region or larger area from the world card',
    site: 'Prefer an established canonical place from the world card',
    spot: 'Write a common spot or the character’s immediate position within that place',
  };

  const statusGroupLabels = {
    datetime: { label: 'Time', year: 'Year', month: 'Month', day: 'Day', time_str: 'Time' },
    location: { label: 'Location', country: 'Region', site: 'Primary Place', spot: 'Specific Spot' },
    money: { label: 'Money', amount: 'Silver' },
    objective: { label: 'Objective', text: 'Current Objective' },
    clues: { label: 'Clues', title: 'Clue Title', source: 'Source' },
  };

  const npcFieldLabels = {
    trigger_type: {
      label: 'Trigger Type',
      desc:
        'NEW=first appearance / UPDATE=runtime state change / NEW_PREDEFINED=first predefined appearance; only id is required',
    },
    id: { label: 'Identifier' },
    name: {
      label: 'Name',
      desc: 'Fill for NEW / UPDATE; may be omitted for NEW_PREDEFINED because the database backfills it',
    },
    gender: { label: 'Gender', desc: 'Short stable value such as Female / Male / Unknown' },
    origin: { label: 'Origin', desc: 'One-line public background or source' },
    birthday: {
      label: 'Birthday',
      desc: 'Pure time value in the format Crossing Era YYY.MM.DD',
    },
    cognitive_state: {
      label: 'Cognitive State',
      desc: 'Who the character currently thinks they are; do not write plot conclusions',
    },
    msg_reply_tone: { label: 'Reply Tone', desc: 'Stable speaking style, not temporary mood' },
    personality: { label: 'Personality', desc: 'Short trait tags' },
    appearance: { label: 'Appearance', desc: 'Most visible traits' },
    clothing: { label: 'Clothing', desc: 'Concrete current outfit' },
    faction: {
      label: 'Faction',
      desc: 'Prefer existing world organizations; use None when there is no affiliation',
    },
    role: { label: 'Role', desc: 'Prefer established world-card functions or place roles' },
    current_goal: { label: 'Current Goal', desc: 'Current task or near-term aim' },
  };

  function localizeSpot(value) {
    return spotNames[value] || locationNames[value] || value;
  }

  function localizeBirthday(value) {
    return typeof value === 'string' ? value.replace(/^渡历/, 'Crossing Era ') : value;
  }

  function localizeEventDay(value) {
    if (typeof value !== 'string') return value;
    const match = value.match(/^(\d+)日$/);
    return match ? `Day ${match[1]}` : value;
  }

  function localizeRelationText(value) {
    return relationTextMap[value] || value;
  }

  function localizeTimelineState(value) {
    return timelineStateMap[value] || value;
  }

  function localizeLocationText(value) {
    if (typeof value !== 'string') return value;
    return value
      .split(' - ')
      .map(part => {
        const trimmed = part.trim();
        return localizeSpot(trimmed);
      })
      .join(' - ');
  }

  const englishSnapshot = clone(base.snapshot);
  englishSnapshot.world_setting.settings = entityTexts;
  englishSnapshot.world_setting._summary = 'A low-magic crossing town with 13 established location entities, including a slow-paced riverside rest shelter as a non-plot space.';
  englishSnapshot.prompt_modules.modules = {
    ...englishSnapshot.prompt_modules.modules,
    ...moduleTexts,
  };
  englishSnapshot.prompt_modules.module_meta = moduleMeta;
  englishSnapshot.prompt_modules.opening_greeting = `The sound of a ferry docking drifts in from the north, mixed with the smell of fresh-cut timber and the warmth of ale carried out from the inn windows.
Sanchadu Town — where road, river, and market meet. The bridge is being repaired, the dock is crowded with people waiting to cross, the notice board cycles through postings faster than usual, inn beds are tighter than normal, and the travelers passing through include some waiting for work, some waiting for news, and some who seem to be waiting for something that has not happened yet.

You are one of them. Before you settle in, tell me:

**1. Time** — When does your story begin?
- A concrete time, for example: Crossing Era 325.03.16 14:20
- Or any time you find fitting, as long as you anchor it to a specific moment.

**2. Location** — Where are you right now?
- The front hall of the Resting Stone inn
- Beside the town notice board
- The ticket booth at the ferry dock
- Anywhere else you want to be

You can also tell me who you are, where you came from, and why you are here — or just choose "Random Start" or "Start with the Recommended Opening" and let fate decide.`;
  englishSnapshot.prompt_modules._summary = '6 rule modules plus an aligned onboarding-style opening.';

  Object.entries(characterTranslations).forEach(([id, data]) => {
    const target = englishSnapshot.character_database?.[id];
    if (!target) return;
    Object.assign(target, data);
  });

  Object.values(englishSnapshot.character_database || {}).forEach(target => {
    if (!target || typeof target !== 'object') return;
    if (typeof target.birthday === 'string') {
      target.birthday = localizeBirthday(target.birthday);
    }
    if (typeof target.default_site === 'string') {
      target.default_site = locationNames[target.default_site] || target.default_site;
    }
    if (Array.isArray(target.common_spots)) {
      target.common_spots = target.common_spots.map(localizeSpot);
    }
  });

  englishSnapshot.character_database._summary =
    '14 core NPCs with default locations, common spots, and opening-useful routines; Marek is the white-collar broker villain bypassing the registry, Beryl is the warm elderly keeper of the riverside rest shelter.';

  if (Array.isArray(englishSnapshot.timeline?.events)) {
    englishSnapshot.timeline.events = englishSnapshot.timeline.events.map(event => {
      const translation = eventTranslations[event.id] || {};
      return {
        ...event,
        day: localizeEventDay(event.day),
        location: localizeLocationText(event.location),
        characters: translation.characters || event.characters,
        content: translation.content || event.content,
      };
    });
    englishSnapshot.timeline._summary =
      '20 events linking bridge repairs, fare disputes, missing records, road sabotage, and cargo discrepancies.';
  }

  if (englishSnapshot.relationship_rules && typeof englishSnapshot.relationship_rules === 'object') {
    Object.values(englishSnapshot.relationship_rules).forEach(rule => {
      if (!rule || typeof rule !== 'object' || !rule.default) return;
      Object.entries(rule.default).forEach(([targetId, relation]) => {
        rule.default[targetId] = localizeRelationText(relation);
      });
    });
  }

  if (englishSnapshot.character_timelines && typeof englishSnapshot.character_timelines === 'object') {
    Object.entries(englishSnapshot.character_timelines).forEach(([id, block]) => {
      if (id === '_summary' || !block || typeof block !== 'object') return;
      if (Array.isArray(block.cognitive)) {
        block.cognitive = block.cognitive.map(item => ({
          ...item,
          state: localizeTimelineState(item.state),
        }));
      }
      if (Array.isArray(block.relationships)) {
        block.relationships = block.relationships.map(item => ({
          ...item,
          relations: Object.fromEntries(
            Object.entries(item.relations || {}).map(([targetId, relation]) => [
              targetId,
              localizeRelationText(relation),
            ])
          ),
        }));
      }
    });
    englishSnapshot.character_timelines._summary =
      '12 core NPC timeline snapshots use next-day 08:00 activation, and every relationship snapshot is a full state.';
  }

  if (Array.isArray(englishSnapshot.step3_fields?.panel_status)) {
    englishSnapshot.step3_fields.panel_status = englishSnapshot.step3_fields.panel_status.map(
      group => {
        const labels = statusGroupLabels[group.key] || {};
        return {
          ...group,
          label: labels.label || group.label,
          _era: group.key === 'datetime' ? 'Crossing Era' : group._era,
          _currency: group.key === 'money' ? 'silver' : group._currency,
          fields: Array.isArray(group.fields)
            ? group.fields.map(field => ({
                ...field,
                label: labels[field.key] || field.label,
                desc: fieldDescTranslations[field.key] || field.desc,
              }))
            : group.fields,
        };
      }
    );
  }

  if (Array.isArray(englishSnapshot.step3_fields?.panel_npc)) {
    englishSnapshot.step3_fields.panel_npc = englishSnapshot.step3_fields.panel_npc.map(field => {
      const labels = npcFieldLabels[field.key] || {};
      return {
        ...field,
        label: labels.label || field.label,
        desc: labels.desc || field.desc,
      };
    });
  }

  if (englishSnapshot.step3_fields?._worldTermsSource) {
    englishSnapshot.step3_fields._worldTermsSource = {
      ...englishSnapshot.step3_fields._worldTermsSource,
      currency_name: 'silver',
      calendar_era: 'Crossing Era',
      calendar_units: ['Year', 'Month', 'Day'],
      location_levels: ['Region', 'Primary Place', 'Specific Spot'],
      extra_status_groups: [
        {
          key: 'clues',
          label: 'Clues',
          icon: '🔍',
          fields: [
            { key: 'title', label: 'Clue Title', type: 'string' },
            { key: 'source', label: 'Source', type: 'string' },
          ],
        },
      ],
      extra_char_fields: [
        {
          key: 'faction',
          label: 'Faction',
          desc: 'Current organization or group; write None if absent',
          type: 'string',
        },
        {
          key: 'role',
          label: 'Role',
          desc: 'Role in the world',
          type: 'string',
        },
        {
          key: 'current_goal',
          label: 'Current Goal',
          desc: 'What the NPC is doing now or trying to do next',
          type: 'string',
        },
        {
          key: 'personality',
          label: 'Personality',
          desc: 'Short trait tags',
          type: 'string',
        },
        {
          key: 'appearance',
          label: 'Appearance',
          desc: 'Most visible traits',
          type: 'string',
        },
        {
          key: 'clothing',
          label: 'Clothing',
          desc: 'Concrete current outfit',
          type: 'string',
        },
      ],
    };
  }

  base.contentLocale = 'zh-CN';
  base.localizations = {
    ...(base.localizations || {}),
    en: {
      name: 'Default World Card: Three-Way Crossing',
      description:
        'A built-in crossing-town world card for mid-length mysteries and ongoing play.',
      contentLocale: 'en',
      snapshot: englishSnapshot,
    },
  };
})();
