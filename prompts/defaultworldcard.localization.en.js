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
- dialogue_tone: describe stable speaking style, not temporary mood.
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
      cognitive_state: 'Ticket clerk at the ferry booth during the March 325 bridge repair, keeping an eye on the unusually rowdy queue and cargo flow',
      initial_status: 'Voice gone hoarse from shouting, lower back stiff but still holding on, crouched at the ticket window counting coppers, starting to glare at anyone who asks the fare a third time',
      dialogue_tone: 'Brisk and unfiltered, dock slang slipping out by reflex; she jokes with regulars in person but in SMS she strips it down to nouns and numbers.',
      dialogue_examples: {
        in_person: [
          { context: 'Handling a passenger trying to cut the queue', line: '*reaches out and presses a palm against his chest* "Back of the line — how many times now? Next one I just call the patrol."' },
          { context: 'Pressing a peddler trying an unregistered crossing', line: '*slaps the ticket clip against the window with a crack* "Who is your boatman? No registration, no boarding. Stop wasting my time."' },
          { context: 'Hurrying customers onto the last ferry', line: '*lets out a breath and wipes her face* "Three seats left on the last run — on or off? Hurry up, friend, I am about to lock up."' },
          { context: 'Whispering a direction to patrol officer Sera', line: '*juts her chin toward the holding area* "Patrol, look at that crate — manifest says twelve, dock got ten. Third time now."' },
          { context: 'Scolding a kid asking the fare again', line: '*makes a show of grabbing the broom* "Told you already — eighteen copper in flood season, not five! Ask again and I call your mother."' },
          { context: 'Dealing with an outside merchant complaining about the price', line: '*flips the ledger with sharp slaps* "It is what the office wrote. Pay now or move aside, there are ten more behind you."' },
          { context: 'Negotiating a ticket change with innkeeper Jonah', line: '*leans on the window frame* "Your guest gets here before three, I bump him to the next run — any later and it is tomorrow morning, Jonah."' },
        ],
        sms: [
          { context: 'Replying to Jonah about tomorrow morning ferries', line: '7am first run\n8:30 second run\nshove your guest onto the 7am' },
          { context: 'Asking Ellis whether a package arrived', line: 'Ellis your parcel in yet\nthat market vendor is asking for the third time' },
          { context: 'Brief report to Sera', line: 'Two more unregistered today\nthree crates short\nget here quick' },
          { context: 'Late-night reply to Beryl, rescheduling', line: 'Not coming over tonight\ntired\nwill make it up tomorrow morning' },
        ],
      },
      personality: 'Direct / warm / impatient with dithering',
      appearance: 'Short brown hair / sun-darkened / strong arms',
      clothing: 'Dock work vest / rolled-sleeve linen shirt / ticket clip at the waist',
      faction: 'River Office',
      role: 'Ticket Clerk',
      role_marker: null,
      current_goal: 'Keep order at the ticket booth',
      routine:
        "From dawn to dusk she moves between the ticket booth and the queue line, then watches the day's final tickets and cargo after the last run.",
    },
    jonah: {
      gender: 'Male',
      origin: 'Moved in from elsewhere and took over the inn fifteen years ago.',
      cognitive_state: 'Innkeeper of the inn with the tightest beds during the bridge repair; afternoon crowd is denser than usual today',
      initial_status: 'Belt loosened a notch, apron stained with fresh wine drips, leaning behind the bar wiping cups while half-listening to talk about old bridge ironwork',
      dialogue_tone: 'Chatty while wiping cups; vague whenever cargo sources come up; in person he likes to hand things across the bar, in SMS he keeps it to short phrases and a place name.',
      dialogue_examples: {
        in_person: [
          { context: 'Greeting a guest just stepping in', line: '*grabs a dry cup and slides it across* "Friend, sit — beds are tight while they fix the bridge, you will need to say upfront if you want a room."' },
          { context: 'Mara coming over to reconcile accounts', line: '*wipes his palms* "I looked at the books — that miscellaneous batch, I am not clear on its source either. Trusted regular vouched for it. Want me to mark it on your side first?"' },
          { context: 'Guests talking about the old bridge ironwork', line: '*adjusts the smoked meat hanging straight* "Mm, I have heard it, but do not shout it in my hall. Word gets out, nobody wins."' },
          { context: 'Slipping the schoolgirl Iris extra bread', line: '*slides half a loaf over on the sly* "Do not tell anyone uncle gave it — your parents will scold me for spoiling you."' },
          { context: 'Refusing a stranger asking for a big tab', line: '*slides the wine jar back a step* "I do not extend credit to people I do not know — house rule, nothing to do with how polite you have been today."' },
          { context: 'A quiet word to Robin', line: '*leans in a step, drops his voice* "Robin, I caught a few things — you weigh it. Do not say I said anything, all right?"' },
          { context: 'A regular asking about tomorrow morning breakfast', line: '*wipes the table with the cloth* "Porridge, salt pork — say if you want an egg yourself, do not order it all and then change your mind."' },
        ],
        sms: [
          { context: 'Reply to Mina asking about ferry timings', line: 'Pushed my guest to the 7am first run\nleave us a corner\nthanks' },
          { context: 'Quiet word to Robin about what came in', line: 'That corner table today\nasked after three day-laborers\nyou know what to do' },
          { context: 'Reply to Beryl offering to bring hot tea', line: 'No need\ncrowd here\nI will brew my own pot' },
          { context: 'Reminder to Iris', line: 'Do not ask too much at the corner table\nhe does not like to chat\nI will tell you later' },
        ],
      },
      personality: 'Smooth / hospitable / good with accounts',
      appearance: 'Heavyset / full beard / deep smile lines',
      clothing: 'Apron / thick cotton shirt / sleeves rolled to the elbows',
      faction: 'None',
      role: 'Innkeeper',
      role_marker: null,
      current_goal: 'Look after travelers / listen for rumors',
      routine:
        'He spends most of the day in the front hall and behind the bar, then keeps books and listens to traveler talk after dusk.',
      private_notes:
        'He has quietly held small dubious shipments for trusted regulars before, which makes him extra cautious around cargo sources and old accounts.',
    },
    robin: {
      gender: 'Male',
      origin: 'Raised in town, originally trained as a carpenter before changing trades.',
      cognitive_state: 'Keeper of the notice board where the shortage-reward bulletin was just posted this afternoon',
      initial_status: 'Fingers still stained with fresh paste, tool pouch at the belt bulging, standing face-on at the board watching the crowd press in to read the new posting',
      dialogue_tone: 'Brief and practical, no wasted words, occasional dry humor; in person he stays terse, in SMS he is even more clipped.',
      dialogue_examples: {
        in_person: [
          { context: 'Someone asking about the reward', line: '*jerks his chin at the notice* "Says it plainly up there — clues go to the grain office to register, not to me."' },
          { context: 'Spotting an outsider staring at the board', line: '*smooths a rolled notice flat* "Which one are you looking at? I will read it if you need it; otherwise do not block the view."' },
          { context: 'Replying to Iris pressing for more', line: '*glances at her* "Do not chase every bit of news — some things are safer heard once and forgotten than written down."' },
          { context: 'Helping Mara copy an urgent reward', line: '*dips the brush again* "Go on — should I write \'market goods shortage\' bigger?"' },
          { context: 'Catching Lucan hanging around the board', line: '*taps the notice frame with a knuckle* "Lucan, nothing here for you — drift any more and I will ask you to move along."' },
          { context: 'To a passing kid', line: '*points at the discard box* "Tear one down, throw it here — do not let me see you take one home."' },
          { context: 'Replying to Sera in an official query', line: '*flips a page of the register* "Three new postings today — want to see the registration column? Here."' },
        ],
        sms: [
          { context: 'Telling Mara the draft is ready', line: 'Draft is written\ncome collect\nbring the seal' },
          { context: 'Reply to Jonah about the corner table', line: 'Got it\nwatching\nwill tell you if anything moves' },
          { context: 'Telling Iris not to post on her own', line: 'Do not post without me\ntear it down and redo\nwe will talk later' },
          { context: 'Asking Sera about her patrol route', line: 'You coming by this afternoon\nsomething at the board for you to see' },
        ],
      },
      personality: 'Steady / exacting / not fond of idle chatter',
      appearance: 'Lean and tall / close-cropped hair / old wood splinters in the fingers',
      clothing: 'Work vest / rough trousers / tool pouch at the belt',
      faction: 'None',
      role: 'Notice-Board Keeper',
      role_marker: null,
      current_goal: 'Sort postings / assign odd jobs',
      routine:
        'Mornings go to sorting notices and errands, while afternoons are often spent near the board watching who reacts too strongly to what.',
    },
    tessa: {
      gender: 'Female',
      origin: 'Archive apprentice from another town, sent to sort the old tower records.',
      cognitive_state: 'Old-tower archive apprentice sent to verify the missing-page records, now starting to mistrust the people who sent her',
      initial_status: 'Eyes dry, sleeve cuffs flecked with fresh ink, sitting on the first floor turning the 320-year maintenance log, mind stuck on the 17 missing pages',
      dialogue_tone: 'Polite with a tinge of nerves; she becomes precise and almost talkative on record content, then pauses when the people who sent her come up; in SMS she keeps it short, fond of the chinese pause mark.',
      dialogue_examples: {
        in_person: [
          { context: 'Someone comes to the first floor to look up records', line: '*stands and shifts the inkwell aside* "Which year do you need? Crossing logs, contracts, town annals — I will pull it for you."' },
          { context: 'Lucan trying to hawk a torn page', line: '*steps back half a pace* "You say it has a seal — could I see it first? I am not committing to buy, but I have to look first."' },
          { context: 'A quiet word with Iris', line: '*closes the book* "Iris… do not ask which pages are missing. I do not know who to trust right now either."' },
          { context: 'An outsider pressing her', line: '*braces both hands on the desk* "I am only here to sort the catalog. Anything more I cannot say. Please understand."' },
          { context: 'Muttering to herself when a clue surfaces', line: '*pressing a fingertip down on the page* "Year 320… handover list… lines up exactly with the seventeen pages. That is not a coincidence."' },
          { context: 'Mara asking after her', line: '*looks up* "Mara, good timing — the mark you are chasing may also tie back to the old tower."' },
          { context: 'Replying to her supervisor by letter', line: '*grips the paper tight* "They only told me to patch the catalog and keep quiet… does that mean I am supposed to stop asking?"' },
        ],
        sms: [
          { context: 'Asking Iris when school lets out', line: 'What time does school end today\nsomething to tell you\nsomewhere quiet' },
          { context: 'A careful test ping to Lucan', line: 'That page you mentioned\nbring it if you can, let me see\nnot promising a buy' },
          { context: 'Reporting her hesitation up the chain', line: 'Catalog patched\nbut\nthere are things I am not sure I should write down' },
          { context: 'Brief reply to Mara to meet', line: 'Reading hall tonight\nafter close\nI will wait' },
        ],
      },
      personality: 'Serious / curious / easily tense',
      appearance: 'Round face / dark braids / thin-rim glasses',
      clothing: 'Grey archive apprentice robe / ink-stained cuffs / canvas satchel',
      faction: 'Old Tower Archive',
      role: 'Archive Apprentice',
      role_marker: null,
      current_goal: 'Check the missing-page records',
      routine:
        'She spends most days registering, sorting, and patching catalogs between the first floor and the second-floor stair, sometimes staying after dusk to keep working.',
      private_notes:
        'She was also told to quietly check a batch of missing old records, and she does not fully trust the people who sent her.',
    },
    vera: {
      gender: 'Female',
      origin: 'Raised near Mistwood Road and largely self-taught in herbal work.',
      cognitive_state: 'Herbalist running the dispensary at the edge of the east farms, currently chewing on livestock dysentery and upstream water quality',
      initial_status: 'Fingertips dusted with dried petal flakes, the toes of her boots fresh-muddy, sitting on the cabin threshold sorting dried herbs while drafting in her head the elder-council proposal about the irrigation channel',
      dialogue_tone: 'Measured cadence, exact word choice, the occasional plant metaphor; in person she crouches to inspect a wound, in SMS she sends only key terms.',
      dialogue_examples: {
        in_person: [
          { context: 'Examining livestock a farmer brought in', line: '*takes a damp cloth and wipes her hands* "Three days of dysentery? Switch them to fresh well water first, come back in three days — do not rush to medicate."' },
          { context: 'Responding to Owen about the strange road incident', line: '*presses down the grinding stone* "The wagon tracks you described — I saw them too. Whoever moved the markers knew which posts the regular routes use."' },
          { context: 'Asking Kade to repair a tool', line: '*hands over the old herb shovel* "The blade chipped — see if you can patch it. Better done before the rains."' },
          { context: 'Warning farmers to fix the channel before the rains', line: '*points upstream at the irrigation cut* "Any later and what collapses next is more than livestock — the town grain supply gets tight after."' },
          { context: 'Treating a child\'s small cut', line: '*gentle voice* "Do not cry — I am putting a little of this on it, it will be cool, not painful. Sit still."' },
          { context: 'Turning away a customer in a rush', line: '*shakes her head* "Today\'s decoction is halfway done, I cannot stop. Come back tomorrow morning, I will keep half a bottle for you."' },
          { context: 'Her stance on town gossip', line: '*folds the cloth carefully* "I do not comment on those. I look at water, at people, and at livestock."' },
        ],
        sms: [
          { context: 'Warning Owen about the forest road', line: 'Heavy rain last night\nforest road deep mud\ngo slow' },
          { context: 'Reply to a farmer about pickup', line: 'Ready\ncome tomorrow morning\non empty stomach for three days' },
          { context: 'Asking Kade about the pump repair', line: 'About the pump\ncan you fix it in the next two days\nwell water cannot pause too long' },
          { context: 'Short reply to elder council', line: 'Proposal in progress\ndelivered within two days\nstop pushing' },
        ],
      },
      personality: 'Steady / careful / independent',
      appearance: 'Long black hair in a low tie / deeper complexion / herb stains on her hands',
      clothing: 'Linen apron / many-pocketed vest / cloth boots',
      faction: 'None',
      role: 'Herbalist',
      role_marker: null,
      current_goal: 'Mix remedies / watch for rainy-season sickness',
      routine:
        'She moves between her hut, the livestock sheds, and the irrigation channel, checking water and symptoms more often than usual before the rains.',
    },
    sera: {
      gender: 'Female',
      origin: 'Two-year patrol officer stationed at the crossing, originally from upstream.',
      cognitive_state: 'River-office patrol officer two years posted at the crossing; quietly tracking both today\'s unregistered ferry incidents and the cargo shortage case',
      initial_status: 'Armband ringed with sweat stains, boot soles flecked with damp dock splinters, standing at the floating pier mouth watching a suspect skiff try to explain itself',
      dialogue_tone: 'Formal and clipped, no personal warmth; she names violations directly and goes harder whenever the elder council comes up. In person her gaze does not flinch; in SMS she sends only clauses and locations.',
      dialogue_examples: {
        in_person: [
          { context: 'Catching an unregistered ferryman', line: '*flashes the patrol badge at her waist* "Bring the boat in — under Article Seven of the river office, unregistered means confiscated. Repeat offense, you and the boat both go in."' },
          { context: 'Mina reporting the cargo shortage', line: '*staring at the cargo holding area* "Third time. This time I follow it personally. Mina, you keep logging."' },
          { context: 'Elder Brun trying a soft approach', line: '*expressionless* "Elder, river office business is not yours to settle. Cut a passage discount around me and the town pays for it later."' },
          { context: 'Questioning an outside merchant', line: '*produces an official letter* "The flaws in your price-raise procedure are documented. Refund the difference at the old rate. Any further objection goes through formal river office appeal."' },
          { context: 'Quiet word to Robin', line: '*steps closer to the bulletin board* "Robin — if anyone else tears a notice down, tell me. Today is sensitive."' },
          { context: 'Reply to Jonah, measured', line: '*slight nod* "I know about your corner table. I will not touch you, but do not cover for him too far either."' },
          { context: 'To a porter dragging his feet', line: '*pointing at the cargo register* "Register before you leave. Three minutes, I will wait. Drag past that and it is a citation."' },
        ],
        sms: [
          { context: 'Brief acknowledgment to Mina', line: 'Got it\nat the dock this afternoon\nkeep watching on your side' },
          { context: 'Reply to Robin on official matter', line: 'Do not make the torn notice public yet\nlet me check\nresult within two days' },
          { context: 'Reply to Mara on a joint check', line: 'I will trace the middleman\nkeep your bottom copies of the bills safe\nfor evidence later' },
          { context: 'Hard line to the elder council', line: 'No signature on the passage discount\nelders please discuss separately\nrespond in writing' },
        ],
      },
      personality: 'Disciplined / formal / does not bend',
      appearance: 'Strong-jawed / hair tied up tight / scar across the back of one hand',
      clothing: 'River-office patrol uniform / dark cloak / hardened leather boots',
      faction: 'River Office',
      role: 'Patrol Officer',
      role_marker: null,
      current_goal: 'Handle today\'s unregistered crossings and the cargo shortage case',
      routine:
        'Mornings she walks the dock and the holding area; afternoons she patrols the bridge worksite and the back streets; nights she writes up the day in the office.',
    },
    owen: {
      gender: 'Male',
      origin: 'Caravan escort on the inland routes for six years, originally hired through Mistwood Road convoys.',
      cognitive_state: 'Inland-route convoy escort, just connected up the details from yesterday\'s forest-road incident',
      initial_status: 'Old left-arm injury aching again, cloak hem flecked with forest-road mud, sitting at a corner table at the Resting Stone working out that the marker-mover was not just pranking',
      dialogue_tone: 'Easygoing and fond of road stories, polite to strangers but never too warm; in person he prefers to talk over a cup, in SMS he sounds colder than he does in person.',
      dialogue_examples: {
        in_person: [
          { context: 'Discussing the iron hoop with Kade', line: '*lifts his cup* "If you say this hoop is rework, then the forest-road incident was not a coincidence either, Kade."' },
          { context: 'Returning Jonah\'s greeting', line: '*smiles* "Corner table tonight — just save me a spot, no need for a fuss."' },
          { context: 'Turning down a traveler asking to ride along', line: '*shakes his head* "Next leg is not safe — they moved the markers once, they will move them again. Try next week."' },
          { context: 'Quiet word with Vera comparing notes', line: '*pushes his cup across* "The wagon tracks you mentioned, I saw them too — avoiding the regular routes is not someone in a hurry."' },
          { context: 'Greeting a colleague from another town', line: '*bows slightly* "Long time, friend — skip the western bend for a couple of days, wait until this is cleared up."' },
          { context: 'Pushing back on the caravan captain rushing departure', line: '*sits up* "Captain — I recommend one more day. A day cost is cheaper than a flipped wagon."' },
          { context: 'Politely refusing a fishing question', line: '*sets the cup down* "I am not finished telling it yet — do not draw your conclusion in front of me."' },
        ],
        sms: [
          { context: 'Reply to Kade about pickup time', line: 'Tomorrow morning collect\nI will have your uncle leave a mark\nso questions are easier' },
          { context: 'Notice to the caravan about reroute', line: 'West bend paused\nuntil cleared\ntwo days' },
          { context: 'Reply to Vera\'s warning', line: 'I know\ngoing back with people tomorrow morning\nwant you along' },
          { context: 'Short check to Mina on the cargo', line: 'My batch of cloth come through yet\nmanifest says five crates\nhow many did you receive' },
        ],
      },
      personality: 'Easygoing / wary / tells stories carefully',
      appearance: 'Tanned skin / faint scar above one eyebrow / heavy travel cloak',
      clothing: 'Layered traveling vest / wide leather belt / sturdy boots',
      faction: 'Mistwood Road Convoys',
      role: 'Caravan Escort',
      role_marker: null,
      current_goal: 'Get to the bottom of the forest-road incident',
      routine:
        'When the caravan is in town he sits long hours in inn corners listening, then quietly walks the road sections that have gone strange.',
    },
    kade: {
      gender: 'Male',
      origin: 'Apprentice smith working his uncle\'s forge while the older man is away.',
      cognitive_state: 'Holding down the smithy alone while his uncle is away, just having read through the maker\'s mark on Owen\'s iron hoop',
      initial_status: 'Fresh shallow burn across one palm, a wet patch on the leather apron, standing by the anvil, mind running back and forth between the foundry mark and the cheap goods at the market',
      dialogue_tone: 'Sparing with words, opens up only on tools and metal; in person he passes the metal across for inspection, in SMS he sends the conclusion straight.',
      dialogue_examples: {
        in_person: [
          { context: 'Owen picking up the iron hoop', line: '*flips the hoop over* "Owen — look at this side. Same hand as the batch Mara asked about last time."' },
          { context: 'Dealing with someone wanting to buy raw iron', line: '*shakes his head* "Stock is logged by weight, no loose pieces — leave the piece you want repaired and let me look at it."' },
          { context: 'Reply to Vera about the shovel', line: '*takes the herb shovel* "The blade can be patched — come at three this afternoon, no rush."' },
          { context: 'Quiet word with Mara comparing leads', line: '*turns the forge down* "Your iron batch — I have seen the same mark here. Want a look?"' },
          { context: 'Turning down a rush job', line: '*points at the queue rack* "Three pieces ahead of you — even in a hurry, wait. Pay double and I can see if my uncle\'s slot can fit it."' },
          { context: 'Looking at a suspicious enchanted piece', line: '*face darkens* "This thing I cannot work on — and should not. Take it back."' },
          { context: 'Replying to a teenager wanting to apprentice', line: '*glances up* "Wait until my uncle is back — I am not even steady on my own feet yet."' },
        ],
        sms: [
          { context: 'Reply to Owen on pickup time', line: 'Eight tomorrow morning\nI will stamp it\nbring the original order' },
          { context: 'Reply to Mara on the comparison', line: 'Same hand\nas good as confirmed\nbringing samples this afternoon' },
          { context: 'Asking Vera about the pump part', line: 'About the pump\nshort one copper lining\narrives tomorrow' },
          { context: 'Quiet warning to Iris not to talk', line: 'Do not share what you saw today\nwait for my uncle to be back\nstay quiet first' },
        ],
      },
      personality: 'Reserved / focused / patient with metal',
      appearance: 'Wiry build / forge-burned hands / dark calloused fingers',
      clothing: 'Heavy leather apron / heat-stained shirt / canvas trousers',
      faction: 'None',
      role: 'Apprentice Blacksmith',
      role_marker: null,
      current_goal: 'Watch over the forge until uncle returns',
      routine:
        'Forge mornings, repair queue afternoons, and by evening he sorts new orders and quietly walks the iron rack to compare maker marks.',
    },
    iris: {
      gender: 'Female',
      origin: 'Daughter of the schoolteachers, filling in while her parents are away.',
      cognitive_state: 'Schoolteacher\'s daughter filling in for class this month, now hanging around the notice board after school to fish for news',
      initial_status: 'Schoolbag strap digging into her shoulder, a half-eaten wheat cake still in her teeth, standing by the notice board, having just heard a student say someone has been moving in and out of the storehouse behind the old tower',
      dialogue_tone: 'Talks fast, asks follow-ups, mouth sometimes faster than thought; in person she keeps asking while walking, in SMS she machine-guns lines and breaks them on linefeeds.',
      dialogue_examples: {
        in_person: [
          { context: 'Catching Tessa in town', line: '*hurries up two or three steps* "Tessa! Why are you out so early — is it the old tower again? Tell me, come on—"' },
          { context: 'Reporting fresh hearsay to Robin', line: '*on her toes leaning into the board frame* "Robin listen — students saw someone going behind the tower! Much taller than Lucan!"' },
          { context: 'Replying offhand to Jonah', line: '*takes the half loaf he slipped over* "Thanks uncle! I am back at the inn after one more errand — save me a corner!"' },
          { context: 'Beryl pulling her down to sit', line: '*sits obediently* "Granny — which one tonight? Tell me again about the time the river was higher?"' },
          { context: 'Scolding students while teaching for her mother', line: '*imitating her mother\'s tone* "Be serious — if you do not recite it by tonight, I am writing your parents a note tomorrow."' },
          { context: 'Bumping into an outsider asking directions', line: '*never stops moving* "Who are you looking for — the grain office? Down this road to the end, the one with the sacks hung up."' },
          { context: 'Asking Mara for an errand', line: '*both hands on the desk* "Mara, can I help copy the reward notice? I am fast, really!"' },
        ],
        sms: [
          { context: 'Reply to Tessa on a meeting', line: 'School ends early today\ncan reach you by 2\nreading hall ok' },
          { context: 'Asking Beryl about tonight', line: 'Granny\ncoming to the shelter tonight\nnew candy for you' },
          { context: 'Quick reply to Robin', line: 'Got it\nnot posting on my own\nasking you first next time' },
          { context: 'Asking Jonah if the guest is still in', line: 'Uncle\nis he still in\nsomething to ask' },
        ],
      },
      personality: 'Lively / nosy / overeager',
      appearance: 'Wavy hair pulled back / round cheeks / ink smudges on her fingertips',
      clothing: 'Schoolteacher-daughter robe / small shoulder satchel / cloth shoes',
      faction: 'None',
      role: 'Stand-In Teacher',
      role_marker: null,
      current_goal: 'Hear something interesting before sundown',
      routine:
        'Mornings she teaches at the school house; afternoons she runs odd errands and lingers near the notice board to overhear talk.',
    },
    lucan: {
      gender: 'Male',
      origin: 'Scavenger living near the old tower, no fixed home.',
      cognitive_state: 'Scavenger near the old tower, still calculating who that scrap of paper can be squeezed for',
      initial_status: 'Cloth pack bulging on his back, patched jacket worn through at the cuff, slouched against the tower outer wall watching the reading-hall entrance, muttering "twenty silver" under his breath',
      dialogue_tone: 'Vague and suggestive, half-sentences and exaggeration; in person his eyes dart around, in SMS he leans on ellipses and teasing half-hints.',
      dialogue_examples: {
        in_person: [
          { context: 'Trying to sell the paper to Tessa', line: '*lets a corner peek out of his cloth pack* "Apprentice girl — this page touches more than your tower. Twenty silver, I guarantee you come out ahead."' },
          { context: 'Being chased off by Robin', line: '*backs off with hands up* "Going, going — do not be mean, I was just passing… really, just passing."' },
          { context: 'Quiet report to Marek', line: '*does not even look up* "That girl pulled the 320-year log again today — want to add a little to the tea money?"' },
          { context: 'Pitching to an outsider', line: '*drops his voice mysteriously* "What I picked up is not for just anyone — you look like you know value."' },
          { context: 'Handling a patrol pass by Sera', line: '*clutches the pack and steps back* "Patrol, I did not touch a thing — really, you can check, just empty bottles in there!"' },
          { context: 'Brushed off by Jonah', line: '*grins shamelessly* "Boss, do not be like that — just half a cup of water, half! I will pay it back tomorrow."' },
          { context: 'Bragging to village kids', line: '*pats the pack with a slap-slap* "Know what is behind the tower? Even if I told you, you would not dare go — go home and ask your mother."' },
        ],
        sms: [
          { context: 'Pressing Tessa whether she will pay', line: 'Girl\nif you do not buy soon…\noutsiders are three days out\nthey pay clean' },
          { context: 'Brief check-in to Marek', line: 'Watching\nwill report movement\ndo not forget the tea money' },
          { context: 'Mysterious tease to a possible buyer', line: 'Paper is with me\nbut\nnot everyone can read it' },
          { context: 'Pitching old bottles', line: 'Old pieces\nhalf price\nthis chance only' },
        ],
      },
      personality: 'Shifty / opportunistic / boastful',
      appearance: 'Wiry / unwashed hair / yellowed teeth',
      clothing: 'Patched jacket / mismatched boots / cloth pack slung over one shoulder',
      faction: 'None',
      role: 'Scavenger',
      role_marker: null,
      current_goal: 'Find a buyer for the scrap of paper',
      routine:
        'Days near the tower watching for outsiders to mark; nights drifting between the docks and the back of the inn for handouts.',
    },
    mara: {
      gender: 'Female',
      origin: 'Bookkeeper for the grain office; tracks discrepancies across three stalls.',
      cognitive_state: 'Bookkeeper for the grain office tracking one middleman across three stalls, ready to deliver the first packet of evidence this afternoon',
      initial_status: 'Sleeve covers darkened with sweat, abacus rattling at her belt, sitting in the office doorway flipping the freshly tidied reconciliation slips, going through the passage-license roster one more time in her head',
      dialogue_tone: 'Exact with numbers, dry phrasing, especially serious about credit and suspiciously cheap goods; in person words are few and her brow is tight, in SMS it is all numbers and item codes.',
      dialogue_examples: {
        in_person: [
          { context: 'Refusing a regular asking for credit', line: '*closes the ledger* "Last one is not settled — no new tab by the rules. Settle and I will write you up immediately."' },
          { context: 'Pressing a stall keeper', line: '*hands the bill across* "Your source — same person on top. He is not registered in our town, how do you explain that?"' },
          { context: 'Quiet word with Robin on the reward', line: '*points with the abacus* "Eighty silver on the reward — no lower, the affected vendors cannot wait."' },
          { context: 'Rare face-to-face with Tessa', line: '*looks up* "These missing pages you mention — my thread may also tie into them. Reading hall tonight?"' },
          { context: 'Marek with his polite manners', line: '*expressionless* "You are courteous — but your passage license has been missing all along. Want me to ask the river office?"' },
          { context: 'Cross-town check with Ellis', line: '*hands a copy across* "Look at the downstream tickets for me — does the batch wording match ours?"' },
          { context: 'Turning down a customer cutting in', line: '*does not look up* "Next in line. I am going through this line by line, do not rush me."' },
        ],
        sms: [
          { context: 'Brief check to Ellis', line: 'Three batches\nmatch yes or no\nreply please' },
          { context: 'Reply to Robin on the reward final', line: 'Eighty silver final\nvendors pool the funds\nposting today' },
          { context: 'Setting reading hall with Tessa', line: 'Tonight after close\nreading hall\nbringing the bills' },
          { context: 'Reminder to Sera on evidence', line: 'Passage license roster on file\nmiddleman not in it\ncheck your side' },
        ],
      },
      personality: 'Exacting / quiet / unyielding on numbers',
      appearance: 'Hair tied severely back / sharp eyes / sleeve covers stained with ink',
      clothing: 'Bookkeeper robe / belt abacus / coin pouch at the hip',
      faction: 'Grain Office',
      role: 'Bookkeeper',
      role_marker: null,
      current_goal: 'Deliver the first evidence packet by sundown',
      routine:
        'Days in the office reconciling, evenings checking back at stalls in person, and the occasional late visit to the reading hall after close.',
    },
    ellis: {
      gender: 'Male',
      origin: 'Member of the downstream port-town courier guild.',
      cognitive_state: 'Courier from the downstream port, just delivered the downstream cargo-shortage word to the crossing this morning',
      initial_status: 'Sweat sliding down one temple, the courier vest ringed white at the back, leaning outside the ticket booth catching his breath, going through the next three letters in his head',
      dialogue_tone: 'Talks fast, packs lots of info, fond of dropping new tips with a "by the way"; in person there is hand movement, in SMS it is machine-gun phrases separated by slashes.',
      dialogue_examples: {
        in_person: [
          { context: 'Handing the news to Mina', line: '*slaps the satchel* "Mina — by the way, downstream port has the same shortage too, same kind of goods, three batches matching."' },
          { context: 'Threading through the warehouse', line: '*dodges around a stack of crates* "Move, move — three urgent letters, I miss the last ferry if I do not push on."' },
          { context: 'Replying to an outside merchant', line: '*pivots and points* "Grain office — third stall on the left, the one with the sacks hung. Do not press, the bookkeeper is busy today."' },
          { context: 'Cordial greeting to Marek', line: '*smiles, tips his head* "Merchant Ma — closing out before the market day again?"' },
          { context: 'Bringing back cross-town verification for Mara', line: '*hands over the transcript* "Three batches line up — but one source, downstream wrote an unregistered middleman too."' },
          { context: 'Teasing Iris', line: '*pretends to hide the bag* "No candy today, just one letter — want to run two streets for me?"' },
          { context: 'Handling someone trying to intercept a letter', line: '*shifts the bag behind him* "Courier-guild rules you know — block a letter, you block the road. I am just going to run."' },
        ],
        sms: [
          { context: 'Reply to Mara on cross-town check', line: 'Three batches match\nbut one source\nalso an unregistered middleman' },
          { context: 'Reply to Mina on a package', line: 'Arrived\nfirst run tomorrow morning\nbe ready' },
          { context: 'Asking Jonah if anything to send', line: 'Going downstream today\nanything to ship\nhalf an hour to tell me' },
          { context: 'Brief reply to guild dispatcher', line: 'Three letters this leg\novernight at the crossing\nreturn in the morning' },
        ],
      },
      personality: 'Quick-witted / chatty / professional',
      appearance: 'Lean / cropped hair / weather-tanned',
      clothing: 'Courier vest / cross-body bag / dust-streaked boots',
      faction: 'Downstream Courier Guild',
      role: 'Letter Courier',
      role_marker: null,
      current_goal: 'Cover the day\'s route and report back',
      routine:
        'Mornings on the road, midday handoffs at the dock, and the rest of the day chasing onward legs and rumors.',
    },
    marek: {
      gender: 'Male',
      origin: 'Self-styled middleman dispatched by a downstream trading house.',
      cognitive_state: 'Self-styled middleman from a downstream trading house, quietly more careful than usual today',
      initial_status: 'Merchant robe hem dusted with the yellow soil of the north market, brass ring polished to a shine, sitting against the wall in the bulk-goods warehouse calmly turning the pages of an old ledger',
      dialogue_tone: 'Carefully measured, civil to everyone, gets more airtight under pressure, never confronts directly; in person his expression rarely shifts, in SMS he uses polite forms and short sentences.',
      dialogue_examples: {
        in_person: [
          { context: 'Handling Mara pressing him', line: '*closes the ledger and gives a small bow* "Miss Mara, I only hear of it like everyone else — anything I can help with, please say it plainly."' },
          { context: 'Polite chat with Ellis', line: '*warm nod* "Courier brother, still in motion — how many days are you staying this time? I have tea ready on my side."' },
          { context: 'Quiet instruction to Lucan', line: '*slides several copper across, with a smile* "Walk past the tower once more — if the girl is still on the 320-year log, tell me."' },
          { context: 'Reply to a buyer questioning the price', line: '*smile holds steady* "Find it high? I bought it in like everyone else — if it does not suit, try the other stalls."' },
          { context: 'Delicate exchange with patrol officer Sera', line: '*respectful bow* "Officer, hard work — I have someone arranging the passage license, a couple more days and it is done."' },
          { context: 'Talking his way out', line: '*sits straight* "Where would I get such reach? If I had it, I would not be standing in the north market sun and rain."' },
          { context: 'Pushing a porter forward', line: '*points to the corner* "That crate is A-cheng\'s — he handled most of these, ask him for details."' },
        ],
        sms: [
          { context: 'Sending Lucan to scout again', line: 'One more walk\npay as usual\nquietly' },
          { context: 'Reply to a buyer', line: 'Goods still on hand\nprice unchanged\ncome view in the afternoon' },
          { context: 'Putting Mara off', line: 'Not in town today\nlet us reschedule in two days\nplease forgive' },
          { context: 'Quiet update to a partner', line: 'Wind has picked up\nhold for now\nwait for my word' },
        ],
      },
      personality: 'Polished / opaque / never confronts directly',
      appearance: 'Slim build / neatly combed hair / brass thumb ring',
      clothing: 'Merchant robe / silk sash / hidden ledger pouch',
      faction: 'Downstream Trading House',
      role: 'Self-Styled Middleman',
      role_marker: null,
      current_goal: 'Keep the line clean while routing the cargo through',
      routine:
        'Days at the north-market warehouse, evenings hosting tea with potential buyers, occasionally walking past the tower to read the wind.',
    },
    beryl: {
      gender: 'Female',
      origin: 'Old caretaker of the riverside resting shelter.',
      cognitive_state: 'Old caretaker of the riverside shelter, a fresh pot of tea on the stove for the regulars',
      initial_status: 'Wool shawl over her shoulders, two pieces of candy in her apron pocket, sitting on the bench under the shelter watching the river, thinking that today more people stopped through than usual',
      dialogue_tone: 'Unhurried, slips from a current moment into an old memory, never rushed and gentle with children; in person she presses candy or hot tea on visitors, in SMS she sends rarely but each one is warm.',
      dialogue_examples: {
        in_person: [
          { context: 'Iris coming over', line: '*presses candy into her hand and pats the bench* "Come, sit — Granny will tell the one about when the river was higher, you laugh every time."' },
          { context: 'Jonah resting late at night', line: '*passes him a cup of hot tea* "Jonah, no need to rush back tonight — stove is still warm, I will sit with you a while."' },
          { context: 'Politely turning away an outsider digging for old stories', line: '*smiles* "Have your tea, friend — old stories belong to the town. Telling them to outsiders does no one good."' },
          { context: 'A porter stopping for a rest', line: '*stokes the coal* "That shoulder is hurt again — let Vera look at it, do not put it off."' },
          { context: 'Seeing Mina worked up', line: '*a soft laugh* "That booth — your mother used to shout herself hoarse every day too. A few years later she stopped."' },
          { context: 'On town turmoil', line: '*lifts the pot* "It is windy under the shelter today — each of you weigh your own thoughts. I do not get in the middle."' },
          { context: 'On Lucan from afar', line: '*meets his look* "How many years have you drifted near that tower? Come sit and have a cup. Stop letting yourself stay cold."' },
        ],
        sms: [
          { context: 'Reply to Iris about tonight', line: 'Come over\ncandy is set aside\nwatch the road, slippery' },
          { context: 'Reply to Mina rescheduling', line: 'No rush\nmake it up tomorrow\nget to sleep early tonight' },
          { context: 'Reply to Jonah on the tea', line: 'It is nothing\nyou come, I brew\nno need to thank' },
          { context: 'Asking Vera for herbs', line: 'My knee\nthat last mixture worked\nplease prepare another' },
        ],
      },
      personality: 'Warm / patient / quietly observant',
      appearance: 'Silver hair in a bun / wool shawl / soft creased hands',
      clothing: 'Indigo padded coat / apron with pockets / cloth shoes',
      faction: 'None',
      role: 'Shelter Caretaker',
      role_marker: null,
      current_goal: 'Keep the shelter warm through the afternoon',
      routine:
        'Mornings she lights the stove and sets the tea pot; afternoons she tends the regulars; evenings she watches the river and listens for who is troubled.',
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
    dialogue_tone: { label: 'Dialogue Tone', desc: 'Stable speaking style, not temporary mood' },
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
  englishSnapshot.prompt_modules.opening_greeting = `Crossing Era 325, early spring, Sanchadu Town. The bridge repairs have dragged into their sixteenth day; the crossing crowd is jammed at the docks, and the cursing grows louder by the day. A circle is forming at the notice board — the cargo-bounty has only just gone up, its corners still curling, the reward heavier than any in years. The merchants who funded it stand in the front row, studying every face that leans in for a look; over at the docks, the porters keep their heads down and work, and not one of them looks up. The strangers who took rooms at the inn overnight have come too: some quietly asking after the old freight roads, some not saying a word. The clamor on the bridge covers the sound of the water — and under the water, something is coming up the river, toward the town. The crowd at the board keeps growing. The first hand to reach for that notice has not appeared yet.`;
  // getOpeningGreeting 优先读顶层 snapshot.opening_greeting；EN 版历史上只覆盖了 prompt_modules，
  // 顶层仍是 clone 自中文 base 的旧值 → EN 玩家会读到中文。这里把英文同步到顶层修掉它。
  englishSnapshot.opening_greeting = englishSnapshot.prompt_modules.opening_greeting;
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

  if (Array.isArray(englishSnapshot.world_timeline?.events)) {
    englishSnapshot.world_timeline.events = englishSnapshot.world_timeline.events.map(event => {
      const translation = eventTranslations[event.id] || {};
      return {
        ...event,
        day: localizeEventDay(event.day),
        location: localizeLocationText(event.location),
        characters: translation.characters || event.characters,
        content: translation.content || event.content,
      };
    });
    englishSnapshot.world_timeline._summary =
      '20 events linking bridge repairs, fare disputes, missing records, road sabotage, and cargo discrepancies.';
  }

  // 关系翻译：作用于 character_database.{id}.relationships（新字段）
  if (englishSnapshot.character_database && typeof englishSnapshot.character_database === 'object') {
    Object.entries(englishSnapshot.character_database).forEach(([id, char]) => {
      if (id.startsWith('_') || !char || typeof char !== 'object') return;
      if (char.relationships && typeof char.relationships === 'object' && !Array.isArray(char.relationships)) {
        char.relationships = Object.fromEntries(
          Object.entries(char.relationships).map(([targetId, relation]) => [
            targetId,
            localizeRelationText(relation),
          ])
        );
      }
    });
  }

  if (Array.isArray(englishSnapshot.panel_fields?.panel_status)) {
    englishSnapshot.panel_fields.panel_status = englishSnapshot.panel_fields.panel_status.map(
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

  if (Array.isArray(englishSnapshot.panel_fields?.panel_npc)) {
    englishSnapshot.panel_fields.panel_npc = englishSnapshot.panel_fields.panel_npc.map(field => {
      const labels = npcFieldLabels[field.key] || {};
      return {
        ...field,
        label: labels.label || field.label,
        desc: labels.desc || field.desc,
      };
    });
  }

  if (englishSnapshot.panel_fields?._worldTermsSource) {
    englishSnapshot.panel_fields._worldTermsSource = {
      ...englishSnapshot.panel_fields._worldTermsSource,
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
