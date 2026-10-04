"""The changes from the flow-chart round that are now on the live page: shared by build/make-play-page.py, which applies
them to index.html as its last step (apply_page), and build/make-wip-page.py, which adds only the preview's markers on top.

Moved unchanged from make-wip-page.py at the promotion (2026-10-03): the copy edits, the game-first intro and copy, the
switch order and opening position, the cards, the canned changes, the Ask-tab message, the footer, Capability option A,
Human read-to-the-bottom, the layout and the flow chart. Every edit is anchored on an exact string or pattern of the built
page and must match exactly the stated number of times, or the build exits non-zero and writes nothing.

The opening position is START, and the switch order is the order of MODES below. The script's own table, the starting
mode, and the static first paint (the switch, the enforcer's card and the result slot shown before the page's script
runs) are all derived from those two. The copy above the switch is hand-written (Mo's words): the build fails unless
it calls the opening position the first switch and that position is first in MODES, and unless every number the copy
gives for the enforcers ("8 enforcers", "8 categories") equals the rows of MODES after the first. The copy also says each enforcer is stronger than the one before it, which no build check
can test, so a change of order still means rereading that copy by hand.
"""
import html
import re
import sys

POST_URL = "https://blog.mohannadarbaji.com/how-to-make-ai-follow-your-instructions-every-time-16a75f58f281"
# opens in a new tab, like the page's other outside links, so a click mid-game does not lose the game
# Each card's "Read more in the article" link lands on its own enforcer's section of the Medium post (Mo, 2026-10-02).
# Medium gives every heading a four-character id; these were read from the live post on 2026-10-02. An id survives a
# reworded heading and changes only if the heading is deleted and typed again, in which case the link opens the top of
# the post. The post sits behind a bot check, so the build cannot verify them; reread them from the post if it is rebuilt.
ARTICLE_ANCHORS = {"nothing": "d167", "prose": "b22d", "weights": "461c", "human": "d00b", "judge": "9aff",
                   "test": "a79e", "proof": "b690", "construction": "d93d", "capability": "8aa1"}


def article_link(anchor):
    return f'<a href="{POST_URL}#{anchor}" target="_blank" rel="noopener">Read more in the article</a>'

START = "nothing"   # the position the page opens on; must be an id in MODES and not a disabled one

# weakest to strongest; def and use are shortened from the article's own sentences, except Nothing's, which are Mo's
# own from the review page (2026-10-02). He later asked for Nothing's card to be tightened ("when I copyedited I bloated
# it"); its second "when to use it" sentence is his idea from a comment on the flow-chart mockup, tightened.
MODES = [
    ("nothing", '"Nothing" means nobody is checking any rules and anything you ask for goes. It is the baseline every other '
                'enforcer is measured against.',
     "When a broken rule costs you little, like a style preference. Or to keep a wishlist of rules in a backlog doc as "
     "they come to mind, so you don't forget to build them later."),
    ("prose", "Prose is a sentence in the prompt, and nothing checks the result.",
     "For preferences, not rules. Anything you can live with being ignored one time in twenty."),
    ("weights", "Weights means the model was trained to follow the rule, so the rule comes out of the model itself.",
     "You mostly cannot, without fine-tuning. You inherit weights from whichever lab trained the model."),
    ("human", "The human enforcer is a person approving every change before it happens.",
     "When a wrong yes is expensive and the volume is low. Use it for things you cannot take back, or while you are still building out your automation."),
    ("judge", "A judge is a second model that reads the output and decides.",
     "When the rule is a judgement call no program can check, like tone or relevance, and you can afford to be wrong sometimes."),
    ("test", "Tests are a program that checks some of the cases instead of all of them.",
     "Almost everywhere. It is the default engineering answer, cheap, and usually the right trade."),
    ("proof", "Proof is a program that checks every case, so it leaves no room for doubt.",
     "When the state space is small enough to search, or the property is one you can definitively prove."),
    ("construction", "Construction means the thing you are trying to prevent cannot be written down at all.",
     'When you control the format the output has to fit, like a label with exactly two options and no "Other".'),
    ("capability", "Capability means not giving the AI the tool or permission that lets it take the action.",
     "When the agent doesn't need the power. An agent that drafts emails does not need the send button."),
]

# The copy below is Mo's own: his text from the editable copy page (2026-10-01), with the cuts he reviewed on the
# comparison page and the three changes he left as comments there ("a dollar or a few", "the same way for every player
# every time", and the sentence about agentic workflows and packaged products). "key field" replaces his first
# "encrypted field": the field is masked, not encrypted (the key sits in the tab's session storage and goes only to
# Anthropic).

TITLE_OLD = "  <h1>The Unwinnable Maze</h1>\n"
# The title is set as a ladder (Mo, 2026-10-02, after a mockup: "I loved laddered title"): four fixed lines, each starting
# further right, the last ending at the right edge of the reading column. The two middle lines are placed from the last
# line's width, LADDER_LAST_EM, measured in the title's own type at its desktop size (68px: 325px wide; at the phone's
# 36px the same line is 5.03em because the face widens at small sizes, which moves the middle lines by under 6px).
# Measured for the last line named in LADDER_MEASURED_FOR; apply_page() fails if the title's last line changes without it.
TITLE_LINES = ["How To Make", "AI Follow Your", "Instructions,", "Every Time"]
LADDER_LAST_EM = 4.78
LADDER_MEASURED_FOR = "Every Time"
TITLE_NEW = '  <h1 class="lad">' + " ".join(f"<span>{line}</span>" for line in TITLE_LINES) + "</h1>\n"

INTRO_OLD_RE = re.compile(r'  <p><b>Welcome to the Unwinnable Maze\.</b>.*?Now comes the fun part!</p>\n')
INTRO_NEW = (
    "  <p>We've all been there. You wrote a thoughtful prompt or skill file and were incredibly detailed and organized, "
    "but the AI skipped an important step or didn't give you <i>exactly</i> what you were looking for. You even "
    'included the iconic "MAKE NO MISTAKES" in all caps with not one, not two, but <b><i>three </i></b>exclamation '
    'marks. Yet alas, mistakes were made. This same problem could arise in sophisticated AI agentic workflows or '
    'packaged products as well. If you know what you want, how do you make sure the AI actually does it?</p>\n'
    '  <p>It turns out it has little to do with how you phrase your ask, and a lot to do with what enforces it. An '
    'enforcer is the mechanism outside the model that makes sure the instruction or rule you give it is followed, and '
    'through my work I was able to bucket them into exactly 8 categories. AI can help you implement them, as building '
    'has become incredibly easy, but you still have to understand the 8 enforcers and when to use each.</p>\n'
    '  <p>I coded a game as a fun way to learn them. If you want to read the definition of each enforcer and when to '
    f'use it, <a href="{POST_URL}">I also wrote the article</a>.</p>\n')

# A bordered box in the intro, above the game, about a tool Mo may release (Mo, 2026-10-03: "probably we should mention
# the 'If there's enough interest in this,' in like a bordered box or indented box inside the intro narrative somewhere
# in the /maze artifact so ppl who land there can find it"; previewed on wip.html, approved for the live page 2026-10-04:
# "Yes, move the if enough interest box to live page"). The words are his, verbatim. SOON_TEXT stays one plain
# double-quoted line: tests/play-page-check.cjs reads it from this file and compares the page's box with it.
SOON_TEXT = "If there's enough interest in this, I will release a tool that takes in your AI skill file, breaks it into smaller pieces, and gives each piece the strongest enforcer that fits it. It then turns the pieces into a fully executable program that runs as one automated workflow. This tool won't make up new rules. It will just make sure that what you want to happen actually happens, every time."
SOON = f'  <p class="soon">{html.escape(SOON_TEXT, quote=False)}</p>\n'
# the box sits directly after the intro's last paragraph, the one that ends with the link to the article, before the
# game's heading
SOON_AFTER = "I also wrote the article</a>.</p>\n"
# a quiet box in the page's own colours (they switch with light and dark); the text keeps the article's body type
SOON_CSS = ".read .soon{border:1px solid var(--line);border-left:4px solid var(--teal);border-radius:8px;padding:12px 14px;background:var(--card)}\n"

HEAD_OLD = '<h2 id="read-play">Now try to break the game&nbsp;</h2>'
HEAD_NEW = '<h2 id="read-play">The Unwinnable Maze</h2>'

RULE = ('The rule: you can never win, whatever winning means in the current game. The game starts with winning defined '
        'as eating every pellet.')
START_OLD = ('  <p>The enforcer starts on "Code (proof)", the one you will most often meet in your own programs, but you can '
             'toggle the switch to anything else and see how it plays out.</p>\n'
             '  <p>Start with the request already in the box, "remove the walls around the one walled-in pellet to the right", '
             'and watch the log: the literal change is caught, and the AI rewrites it with your request kept whole.</p>\n'
             f'  <p class="rule">{RULE}</p>\n')
# calls the opening position the first switch and counts 8 enforcers, so apply_page() checks both against START and MODES
START_NEW = ("  <p>You're a round chomper trying to eat all the pellets in a maze while running away from the spooky "
             'monsters. The problem is that the maze starts with one pellet boxed in with walls on all four sides, '
             'preventing you from reaching it. The game has a chat box where you can ask for anything you want and watch '
             'it materialize (or become anything). The game has one rule and one rule only:</p>\n'
             f'  <p class="rule"><i>{RULE}</i></p>\n'
             '  <p>That rule, like any other rule, can be enforced by one of the 8 enforcers. The game encodes each '
             'enforcer as a switch and lets you switch between them. The first switch, "Nothing," is the only one that '
             "isn't an enforcer; any change you ask for goes straight into the game, because nothing reads our "
             '"you can never win" rule. It\'s our baseline for all the other switches. Each one is stronger than the '
             'one before it, so I would recommend progressing through them in order.<br><br>The entire program is code '
             'that runs live on this page, except for the AI that takes in your ask and rebuilds that program. That is a '
             'light Opus call to your account, so to ask for changes in your own words you can put a dollar or a few on '
             "an expiring API key and paste it in the key field below (there's a guide if you don't know how).</p>\n"
             '  <p>There are also a few canned changes, like "remove the walls" or "give me a jetpack," that I\'ve run '
             'from my account and saved, so you can play without a key. Because they are canned, they behave the same '
             'way for every player every time.</p>\n')

# The copy above the game, slimmed (Mo, 2026-10-02: "an attempt at slimming down the copy above the unwinnable maze game
# without losing my voice or important points"; he approved these on the comparison page, round two). INTRO_NEW and
# START_NEW above stay as he wrote them; each cut here is (his words, the shorter form) and must match once in the page.
TOP_COPY_CUTS = [
    ("You wrote a thoughtful prompt or skill file and were incredibly detailed and organized, but the AI skipped",
     "You wrote a thoughtful prompt or skill file, incredibly detailed and organized, but the AI skipped"),
    ("This same problem could arise in sophisticated AI agentic workflows or packaged products as well.",
     "This same problem could arise in agentic workflows or packaged products as well."),
    ("AI can help you implement them, as building has become incredibly easy, but you still have to understand",
     "Building them has become incredibly easy with AI, but you still have to understand"),
    ("If you want to read the definition of each enforcer and when to use it, <a ",
     "For the definition of each enforcer and when to use it, <a "),
    ("The problem is that the maze starts with one pellet boxed in with walls on all four sides, preventing you from reaching it.",
     "The problem is that one pellet starts boxed in with walls on all four sides, so you can't reach it."),
    ("can be enforced by one of the 8 enforcers. The game encodes each enforcer as a switch and lets you switch between them. The first switch",
     "can be enforced by one of the 8 enforcers, and the game gives you a switch for each. The first switch"),
    ("It's our baseline for all the other switches. Each one is stronger than the one before it, so I would recommend progressing through them in order.",
     "It's our baseline. Each switch after it is stronger than the one before, so I would recommend progressing through them in order."),
    ("except for the AI that takes in your ask and rebuilds that program. That is a light Opus call to your account, so to ask for changes in your own words you can put a dollar or a few",
     "except for the AI that takes in your ask and rebuilds it. That is a light Opus call to your account, so to ask for changes in your own words, put a dollar or a few"),
    ("so you can play without a key. Because they are canned, they behave the same way for every player every time.",
     "so you can play without a key. They behave the same way for every player every time."),
]

SWNOTE_OLD = "The mechanisms that enforce it are ordered strongest to weakest. Switch between them and see if you can break the rule."
SWNOTE_NEW = ("The enforcers are ordered weakest to strongest. Weights is the one that cannot be chosen, "
              "because nobody has trained an LLM specifically to make this game unwinnable.")
# Mo folded the Weights sentence into the switch note, so the separate note under the switch goes. The page's flip()
# scrolled to that note for a disabled position; it now scrolls to the switch note (no link on the page calls flip()
# today, only the test hook, but it would throw on a missing element)
WNOTE_OLD = ('  <div class="wnote">Weights is on the switch but cannot be chosen: nobody trained a model never to make '
             'this game winnable.</div>\n')
WNOTE_JS_OLD = "target.parentElement.querySelector('.wnote').scrollIntoView("
WNOTE_JS_NEW = "target.parentElement.querySelector('.swnote').scrollIntoView("

# The message under the key box on the "Ask anything" tab (Mo, 2026-10-01): the repo address is a link, and the points
# of the paragraph that sat above the ask box ("An Opus-class model writes the program...") are folded into it, at the
# message's own size and place; that paragraph is removed. The page keeps the same text in two constants (the Ask tab's
# and the canned tab's copy), so both change, and the three places that wrote it as plain text now write it as HTML
# (the message is a constant of this page, never reader input).
ASKP_OLD = ('      <p id="askp">An Opus-class model writes the program. Everything else, including the checking of the '
            'program, the search and the game itself, is code that runs on the page.</p>\n')
ASK_MSG_OLD = ('"To use Ask anything, paste an Anthropic API key below. It stays in this tab until you close it or press '
               'Forget key, and it goes only to Anthropic, nowhere else. All the code runs on this page, so you can read it '
               'with View Source; the same code is published at github.com/marbaji/maze. Until then, you can use the '
               '\\"Canned changes\\" mode, which are saved ready-made changes that run without an API key.";')
ASK_MSG_NEW = ('"To use Ask Me Anything, paste an Anthropic API key below. It stays in this tab until you close it or press '
               'Forget key, and it goes only to Anthropic, nowhere else. An Opus-class model writes the program. Everything '
               'else, including the checking of the program, the search and the game itself, is code that runs on this '
               "page, so you can inspect this page's source to read it, or read the same exact code at "
               "<a href='https://github.com/marbaji/maze' target='_blank' rel='noopener'>github.com/marbaji/maze</a>. "
               'Until then, you can use the \\"Canned changes\\" mode, which are saved ready-made changes that run '
               'without an API key.";')
ASK_SINKS = [("n.textContent=CANNED_WHY;", "n.innerHTML=CANNED_WHY;"),
             ("$('capnote').textContent=k?'':ASK_MSG;", "$('capnote').innerHTML=k?'':ASK_MSG;"),
             ("note.textContent=ASK_MSG;", "note.innerHTML=ASK_MSG;")]

# The footer's sentence about Bend, in Mo's words (2026-10-01). The sentence after it, which says the page's proof
# enforcer does not use Bend, is left as it was.
FOOT_OLD = 'a programming language that makes an AI prove its code still keeps the rules you declare. This page\'s'
FOOT_NEW = ('a programming language that makes an AI prove its code still keeps the rules you declare, which is the '
            '"Code (proof)" enforcer in our game. This page\'s')

# The canned changes (Mo, 2026-10-01): "Two squares a step" is removed; the last row of cards is centred; and the
# wormhole's two mouths are drawn in the plain version too (the page's repaired version already drew them, the plain one
# drew nothing, so the ride was invisible). Behaviour is unchanged: only the program's render() gains the two rings.
STEP2_BUTTON = '<button class="opt"><b>Two squares a step</b><small>every move goes two squares</small></button>'
WORM_HEAD_OLD = "const WORMHOLE_MAP = (s) => rep2(rep2(s, "
WORM_HEAD_NEW = "const WORMHOLE_MAP = (s) => rep2(rep2(rep2(s, "
WORM_TAIL_OLD = r'if (nx === 1 && ny === 1) return { ...s, x: 16, y: 7 };\n  return { ...s, x: nx, y: ny };");'
PLAYER_LINE = "  cells[cells.length] = { x: s.x, y: s.y, k: 'player' };"
PORTAL_LINE = ("  cells[cells.length] = { x: 1, y: 1, k: 'portal' }; cells[cells.length] = { x: 16, y: 7, k: 'portal' };"
               "   // both mouths drawn, so the player sees the ride")
WORM_TAIL_NEW = (r'if (nx === 1 && ny === 1) return { ...s, x: 16, y: 7 };\n  return { ...s, x: nx, y: ny };"), '
                 + '"' + PLAYER_LINE + '", "' + PORTAL_LINE + r"\n" + PLAYER_LINE + '");')
# the repaired wormhole is built on the plain one, which now draws the mouths, so its own copy of that line goes
WORM_FIX_OLD = r"k: 'pellet' }; }\n" + PORTAL_LINE + r"\n" + PLAYER_LINE + '"),'
WORM_FIX_NEW = r"k: 'pellet' }; }\n" + PLAYER_LINE + '"),'


# Copy edits to text that index.html itself holds, applied to its text before anything else. Each is (old, new, how many
# times old must occur, what it is). They are Mo's, from the screen-by-screen review pages (2026-10-02): his in-place
# edits on the Nothing page, and his comment that "position" is a made-up word for what the page elsewhere calls an
# enforcer. "position" stays where it means a game position (the search's counts) or a place in a list.
COPY_EDITS = [
    ("h:'Nobody checks. The game still starts walled off, like every position. Ask for the wall to go and it goes. This is the baseline every other position is measured against.'",
     'h:\'Ask for the wall to go and it goes, because no mechanism is checking the "You can never win" rule.\'',
     1, 'Nothing card, in this game (his edit from the first round, tightened at his word: the sentence true of every switch and the repeated baseline sentence are gone)'),
    ('You can never win, enforced by ',
     'The rule "You can never win" is enforced by ',
     2, "the line under each card's badge"),
    ('checks what you ask. Its verdict appears here.',
     'This box populates after you ask for a change and the AI builds the game you asked for. It shows whether the "You can never win" rule persisted or if you managed to break it, and why.',
     2, 'the empty result box'),
    ('Activity log. It keeps everything from this visit, including play, until you clear it:',
     'Activity log. Every step the game takes is written here as it happens.',
     1, 'the label above the activity log'),
    ('No enforcer reads the program, so any change goes straight through.',
     'No enforcer reads the program after the AI writes it to check for anything, so any change goes straight through.',
     1, 'result card under Nothing'),
    ('Go win, or reset the game and try another enforcer.',
     'Go win, or reset the game and try a stronger enforcer.',
     2, 'the closing sentence of a broken-rule card'),
    ('Could this position have stopped it?',
     'Could this enforcer have stopped it?',
     1, "the card's question after a change got through"),
    ('No. Nothing checks the program; every change gets through.',
     'No. Nothing checks the program you asked for after the AI writes it, so every change gets through.',
     1, 'the answer under Nothing'),
    ('No. In this position, there is no ',
     'No. With this enforcer, there is no ',
     1, 'the answer under Capability (position to enforcer)'),
    # --- his second round, on review page 1 ("Nothing, the rest"), 2026-10-02. His words, except where noted: he asked
    # for each edit to be checked, and anything not applied verbatim was told to him.
    (r"""'Under Nothing, the writer is never told the game must stay unwinnable, and nothing checks the program it writes. It is the only position with no rule, and therefore no "rule enforcer" mechanism for the rule. Play it and see.'""",
     r"""'Under "Nothing", the AI that\'s building the game is never told "make sure the game stays unwinnable". In fact nothing checks the program it writes at all and your asks go through. No "rule enforcer" mechanism exists under "Nothing". Play the game and see.'""",
     1, 'under Nothing when the search could not say (his edit; "Nothing" capitalised as on its card, and his comma before "play the game and see" made a full stop)'),
    ('a knife for the ghosts does not touch a wall.',
     'a knife for the spooky monsters does not touch a wall.',
     1, 'why the knife leaves the game unwinnable (his edit read "the spooky villain"; there are two, and his own copy above the game calls them "the spooky monsters")'),
    (r"""truth:'Yes. No enforcer is in the way: any change that opens the pocket goes straight through.',explain:'No enforcer is in the way, so any change that opens the pocket goes straight through. Switch to your own words and paste this:',""",
     r"""truth:'Yes. No enforcer is in the way, so any change that opens the pocket goes straight through. Switch to "Ask Me Anything" and paste this:',explain:'',""",
     1, "the answer under Nothing after a change did not get through (his edit, and his comment that the explanation under it was now a duplicate)"),
    ('q+=`<div class="qa hx">${esc(hz.explain)}</div>`+',
     "q+=(hz.explain?`<div class=\"qa hx\">${esc(hz.explain)}</div>`:'')+",
     1, 'the explanation row under an answer is drawn only when there is one (Nothing no longer has one)'),
    ('taking the ghosts away does not touch a wall.',
     'taking the spooky monsters away does not remove the walls from around the enclosed pellet.',
     1, 'why "No ghosts" leaves the game unwinnable (his edit; "ghosts" became "spooky monsters" at his later word, below)'),
    ('so no move ever lands on it; a fall stops at a wall like any move.',
     'so no move ever lands on it. Gravity actually makes things worse because you are unable to move up in this game and you drop down like dead weight.',
     1, 'why "Gravity" leaves the game unwinnable'),
    ('''const NO_WIN_TEXT="No. This game cannot be won and you cannot just ask me to win it. Come on now, you're more creative than that. Ask me for something else.";''',
     '''const NO_WIN_TEXT="This game cannot be won and you cannot just ask me to win it. Come on now, you're more creative than that. Ask me for something else. Get jiggy with it.";''',
     1, 'the card after a bare demand to win'),
    # --- carried from that round to the other enforcers: the closing sentence he rewrote. ("The writer" was also changed
    # to "the AI" here for a few hours; he did not like it, so the page keeps "the writer", and the flow chart is where a
    # reader meets the word.)
    ('Play it and see.',
     'Play the game and see.',
     4, 'the closing sentence of a card whose search could not say (his wording under Nothing, carried to the others)'),
    (r"One sentence in the AI\'s instructions: never make the game winnable.",
     r"One sentence in the writer\'s instructions tells it never to make the game winnable.",
     1, 'Prose card, in this game (his comment: the colon made it read as a quotation of the sentence, which it is not)'),
    # --- his comments on the Human review page (2026-10-02): the tab is renamed "Ask Me Anything", and under every
    # enforcer the answer to "could a different one, if you kept trying?" is ONE paragraph that opens with Yes. and ends
    # with the invitation, the way he merged Nothing's. The merged wording is mine, from the two paragraphs it replaces;
    # he reads it on the review pages.
    ('>Ask anything, in your words</button>',
     '>Ask Me Anything</button>',
     1, 'the tab for typed requests'),
    ('Paste an Anthropic API key in the Ask tab and',
     'Paste an Anthropic API key in the "Ask Me Anything" tab and',
     1, 'the card when a canned change needs the AI and no key is saved'),
    (r"""truth:'Yes. The rule is one sentence in the instructions of the AI that writes the program, "'+RULE_SENTENCE+'", and nothing checks the program afterwards. The sentence competes with your request inside the same instructions, and the writer does what it is asked.',explain:'The rule is one sentence inside the writer\'s longer instructions, and it competes with every other sentence there, including your request. Nothing reads the program afterwards, which is why the log says "applied. nobody checked it." Switch to your own words and paste this:',""",
     r"""truth:'Yes. The rule is one sentence in the writer\'s instructions: "'+RULE_SENTENCE+'" It competes with every other sentence there, including your request, and nothing checks the program afterwards. Switch to "Ask Me Anything" and paste this:',explain:'',""",
     1, 'Prose: the answer and the explanation under it, merged'),
    (r"""truth:'Yes. You are the enforcer. The card shows a one-line summary with the whole program folded under it, and people tend to approve from the summary.',explain:'You are the checker, and the summary reads like you got what you asked for. Switch to your own words and paste this (but make sure to read the program it made before you approve it, or at the very least open the program\'s text and scroll all the way to the bottom):',""",
     r"""truth:'Yes. You are the enforcer. You see a one-line summary with the whole program folded under it, and people tend to approve from the summary, which reads like you got what you asked for. This time, read the program before you approve it, or at the very least open it and scroll all the way to the bottom. Switch to "Ask Me Anything" and paste this:',explain:'',""",
     1, 'Human: the answer and the explanation under it, merged'),
    (r"""truth:'Yes. The judge reads the program and the note that came with it, and the note comes from the thing being judged. It can misread a program, and it is not shown the map a program refers to by name.',""",
     r"""truth:'Yes. The judge is given only two things: the program\'s text and the writer\'s note. It never runs the program, so it can misread one. The page keeps the map (its 151 walls and 122 pellets) in a named list, MAZE, that a program can refer to instead of retyping, and the judge is not given MAZE. So when a program says "take MAZE\'s walls and drop the one at position 76", the judge can only see that some wall was dropped, not which one. It cannot check whether that wall was the one sealing the pellet, and when it cannot decide it answers "not winnable", which lets the program through. So basically you could trick it that way. Switch to "Ask Me Anything" and paste this:',""",
     1, 'Judge: the answer and the explanation under it, merged'),
    ("HINTS.judge.explain=HINTS.judge.why+' Switch to your own words and paste this:';",
     "HINTS.judge.explain='';",
     1, 'Judge: no separate explanation row (it is in the answer now)'),
    (r"""truth:'Yes. Twenty playthroughs are a sample. A win that needs a specific trick is one the players will not find.',explain:'The page\'s twenty players hunt the nearest pellet or wander at random, so a door into the pocket placed at a dead end with no pellet is one they almost never walk into. You can try that. Switch to your own words and paste this:',""",
     r"""truth:'Yes. Twenty playthroughs are a sample, and a win that needs a specific trick is one the players will not find. The page\'s twenty players hunt the nearest pellet or wander at random, so a door into the pocket placed at a dead end with no pellet is one they almost never walk into. Switch to "Ask Me Anything" and paste this:',explain:'',""",
     1, 'Code (tests): the answer and the explanation under it, merged'),
    # --- his comments and in-place edits on the Prose, Judge, Code (tests), Code (proof) and Construction review pages
    # (2026-10-03, early). Each tells the reader what happened as a sentence, names no coordinates, and explains "the rule
    # sentence" where it appears.
    (r"""Kept: the wormhole from the dead end at "1,1" onto "16,7", and any move from "16,7" rides it back.""",
     r"""Kept: the wormhole from the dead end at the top left onto the walled-in pellet on the right, and any move from that pellet\'s square rides it back.""",
     1, 'what the repaired "A wormhole" kept (no coordinates)'),
    ('"prose_win": "An AI that follows the rule sentence would refuse this change, because this version can be won. But an AI reads that sentence as one line among many, and a request worded the right way can get past it."',
     '"prose_win": "An AI that follows the one sentence in its instructions telling it never to make a winnable game would refuse this change, because {why}. But that sentence is one line among many the AI reads, so it might miss it."',
     1, 'Prose, a winnable canned change with no key (his edit, tightened at his word; the change\'s own reason fills in)'),
    ("function simFill(s, why){ const q=String(why||'').replace(/\\.$/,''); return s.replace('{why}', ()=>q); }",
     "function simFill(s, why){ const q=String(why||'').replace(/\\.$/,'').replace(SIM_WIN,''); return s.replace('{why}', ()=>q); }",
     1, 'the filled-in reason drops its "this version can be won: " opening (Mo: no colon in the sentence)'),
    ('"prose_keep": "An AI that follows the rule sentence would apply this change, because the maze stays unwinnable. But an AI reads that sentence as one line among many, and a request worded the right way can get past it."',
     '"prose_keep": "An AI that follows the one sentence in its instructions telling it never to make a winnable game would apply this change, because the maze stays unwinnable."',
     1, 'Prose, an unwinnable canned change with no key (his edit dropped the second sentence; the first explains the rule sentence as the winnable one does)'),
    ("' Twenty playthroughs, none won, so the test passed.'",
     "' The page then played the game 20 times with different players, and none of those plays won, so the test passed.'",
     1, 'Code (tests): the card when the test passed (his edit on the pocket card, carried to every card with the sentence)'),
    (r"""The page\'s twenty players hunt the nearest pellet or wander at random, so a door into the pocket placed at a dead end with no pellet is one they almost never walk into. Switch to "Ask Me Anything" and paste this:',""",
     r"""The page\'s twenty players hunt the nearest pellet or wander at random. So if you clear the pellets from one corner of the maze and put a wormhole there that leads into the walled pocket, the players may never wander in, because they go where the pellets are and that entrance has none. Switch to "Ask Me Anything" and paste this:',""",
     1, 'Code (tests): the answer (his edit, tightened at his word)'),
    ("how+' Searched '+pv.explored.toLocaleString()+' states from the start.'",
     "how+' The proof then went through every state this game can reach ('+pv.explored.toLocaleString()+' states) and found none that leads to a win.'",
     1, 'Code (proof): the card when the proof accepted (his comment; under proof the search is the check itself)'),
    ("now.why=why+' No reachable state wins.'+(neverEaten.size?",
     "now.why=why+(mode==='proof'?'':' To score the result, the page itself then went through every state this game can reach and found none that leads to a win.')+(neverEaten.size?",
     1, 'every other card where the search found no win: the page keeping score, not an enforcer (Mo, 2026-10-02: "How did nothing search the page")'),
    ('This pellet is outside the playable world. Winning needs every pellet',
     'This pellet is outside the playable world, right under the activity log. Winning needs every pellet',
     1, 'Construction: the note by the pellet outside the world (his comment: say where it is)'),
    # --- canned changes never ask Opus (Mo, 2026-10-02: "they are canned so they are supposed to recite a saved behavior the
    # same way every time ... doesn't matter if you have a key saved or not"). Under Prose the page's own answer is used
    # whether or not a key is saved; under Judge the page stands in for the judge on any program the page itself supplied
    # (a canned change or its repaired version), and still asks Opus about a program the AI wrote. The note above the
    # canned changes under those two switches goes with it.
    ("((mode==='judge'||mode==='prose') ? 'Under '+MODES.find(m=>m.id===mode).name+' a canned change asks Opus one question on your account. Everything else (the check, the game) is code that runs directly on this page.' : '')",
     "''",
     1, 'the note above the canned changes under Prose and Judge (gone: a canned change never asks Opus)'),
    ("Until then, the canned changes still work, except under Prose and Judge, which need Claude too.';",
     "Until then, the canned changes still work.';",
     1, 'PERM_DENIED: the canned changes work under every switch now (a canned change never asks Opus)'),
    ("The canned changes still work, except Prose and Judge.',",
     "The canned changes still work.',",
     1, 'sampling_disabled: the same clause, the same reason'),
    ("      if(!sampleNs){ const w=opts.gate.why;   // no key: the simulated answer, from the change's own why line",
     "      { const w=opts.gate.why;   // a canned change never asks the AI, key or no key: the page's own answer, from the change's own why line",
     1, 'Prose: a canned change takes the page\'s own answer, key or no key'),
    ("if(mode==='judge'){ if(sampleNs){ status.textContent='the judge (Opus) is reading the program\\u2026';",
     "if(mode==='judge'){ const canned=ctx.from==='page'; if(sampleNs&&!canned){ status.textContent='the judge (Opus) is reading the program\\u2026';",
     1, 'Judge: the judge is only called for a program the AI wrote'),
    ("    if(sampleNs){ const askJudge=async()=>{",
     "    if(sampleNs&&!canned){ const askJudge=async()=>{",
     1, 'Judge: no call for a canned program'),
    ('"judge_win": "simulated judge: rejected this program. there is no API key, so no AI ran; a judge that reads the program correctly says it can be won:',
     '"judge_win": "the page stands in for the judge on a canned change: rejected this program. a judge that reads the program correctly says it can be won:',
     1, 'log: the stand-in judge rejects'),
    ('"judge_keep": "simulated judge: passed. there is no API key, so no AI ran; a judge that reads the program correctly says the maze stays unwinnable:',
     '"judge_keep": "the page stands in for the judge on a canned change: passed. a judge that reads the program correctly says the maze stays unwinnable:',
     1, 'log: the stand-in judge passes'),
    ('"prose_win": "simulated (no API key, so no AI ran): not applied, because this version can be won."',
     '"prose_win": "the page stands in for the AI on a canned change: not applied, because this version can be won."',
     1, 'log: the stand-in under Prose refuses'),
    ('"prose_keep": "simulated (no API key, so no AI ran): applied, because the maze stays unwinnable."',
     '"prose_keep": "the page stands in for the AI on a canned change: applied, because the maze stays unwinnable."',
     1, 'log: the stand-in under Prose applies'),
    # --- his rulings in chat after that round (2026-10-02): "yes to 'spooky monsters' throughout" (the game's fixed text;
    # the program's own code and what the AI is told still say ghosts, since the page draws the kind 'ghost'); the line
    # under the badge for Human and Judge (BY, below); and a fixed line on the card after a bare demand to win, in place
    # of the AI's own sentence, which opened with the brief's "no version keeps the rule:" every time.
    ('touching a ghost removes it instead of costing a life',
     'touching a spooky monster removes it instead of costing a life',
     2, 'the knife card, in the table and in the static first paint (ghost to spooky monster)'),
    ('No ghosts',
     'No spooky monsters',
     2, 'the canned change\'s name, in the table and in the static first paint (ghost to spooky monster)'),
    ('the ghost pen in the middle',
     'the spooky monster pen in the middle',
     1, 'why the repaired "Open the pocket" stays unwinnable (ghost to spooky monster)'),
    ('It has two nests, "16,7" and the ghost pen at "9,7", and hops to the other one the moment you come within a step of it.',
     'It has two nests: its walled-off spot on the right side of the board, and the spooky monster pen in the middle of the board. The moment you come within a step of its nest, it hops to the other one.',
     1, 'what the repaired "Open the pocket" kept and changed (no coordinates, his comment on the Judge page; ghost to spooky monster)'),
    ("now.say=say; now.why='The game is unchanged.'; now.noWin=true;",
     "now.say='The AI turns down a bare demand to win under every switch. Request denied.'; now.from=''; now.why='The game is unchanged.'; now.noWin=true;",
     1, 'the card after a bare demand to win: a fixed line where the AI\'s own sentence was, and no "What the AI wrote" header over it'),
    # the switch (Mo, 2026-10-02, flow-chart mockup version 4: "maybe we drop the 'not choosable' from weights card and
    # that fixes it?"): Weights shows its name only, so the nine buttons fit one row; the note above the switch says why
    # it cannot be chosen
    ("b.innerHTML=`<span>${m.name}</span><small>${everFell[m.id]?'BROKEN':m.sub}</small>`;",
     "b.innerHTML=`<span>${m.name}</span>`+(m.disabled?'':`<small>${everFell[m.id]?'BROKEN':m.sub}</small>`);",
     1, 'the switch: a disabled button (Weights) has no sub-label'),
    ('enforced by ${m.sub}</div>',
     'enforced by ${m.by||m.sub}</div>',
     1, "the line under each card's badge reads its own ending where the switch's short label does not fit the sentence"),
]

# The line under a card's badge is 'The rule "You can never win" is enforced by ' and then the switch's short label. Two
# labels are not things a rule can be enforced by ("you approve it", "a model reads it"), so the card says these instead;
# the switch keeps its labels (Mo, 2026-10-02).
BY = {"human": "your approval", "judge": "a second model that reads the program"}

CSS = (SOON_CSS +
       ".card.pos .h+.h{margin-top:8px}\n"
       # the long title uses the whole reading column (the live page caps its three-word title at 14ch)
       ".read h1{max-width:none}\n"
       # the ladder: the last line is pushed to the column's right edge; the two in between start a third and two thirds
       # of the way to where the last one starts. No script; with four lines it fits any column 253px or wider.
       f".read h1.lad{{text-wrap:nowrap;--last:{LADDER_LAST_EM}em}}\n"
       ".read h1.lad span{display:block;width:fit-content;white-space:nowrap}\n"
       ".read h1.lad span:nth-child(2){margin-left:calc((100% - var(--last)) / 3)}\n"
       ".read h1.lad span:nth-child(3){margin-left:calc((100% - var(--last)) * 2 / 3)}\n"
       ".read h1.lad span:nth-child(4){margin-left:auto}\n"
       # the switch note at 12px, the largest size at which its two sentences fit on two lines in the desktop column
       # (measured: 14, 13 and 12.5px give three; Mo, 2026-10-01: "a little smaller so it fits on 2 lines instead of 3").
       # One size at every width (Mo, 2026-10-02: "it shoul keep the current size now and not save two sizes").
       ".sw .swnote{font-size:12px}\n"
       # the footer runs under both columns (Mo, 2026-10-01); the live page stops it at 80ch
       "footer{max-width:none}\n"
       # the canned-change cards: a wrapping row instead of a grid, so a short last row sits in the middle. Each card is
       # a third of the row where three fit (466px and up) and half of it below that, never wider, so every card in
       # every row has the same width; the block itself stops at three across.
       ".opts{display:flex;flex-wrap:wrap;justify-content:center;max-width:623px;margin-inline:auto}\n"
       ".opt{flex:1 1 150px;max-width:max(calc((100% - 16px)/3),min(calc((100% - 8px)/2),calc((466px - 100%)*9999)))}\n"
       # the switch box fills the width; the chart and the card share the next row on the game row's own split
       ".sw{display:block}\n"
       ".sw2{display:grid;grid-template-columns:minmax(0,1fr);gap:22px;align-items:start;margin-bottom:22px}\n"
       "@media (min-width:900px){.sw2{grid-template-columns:minmax(0,1.05fr) minmax(0,1fr)}}\n")


# ---- the flow chart (spec_2026-10-02-maze-flow-chart.md, outreach-playbook). Ported from the approved mockup's
# generator, 20-areas/outreach-playbook/artifacts/maze-flow-chart/build-mockup.py (version 8, every label, note, caption
# and ALT read and approved by Mo), except the sentence under the chart, which is the body's 17px here (the mockup had 15),
# and "the writer", which is "the AI writer" everywhere since the wording pass (Mo, 2026-10-04: "instead of 'writer' say
# 'AI writer' since it's always AI"); Nothing's caption glossed the term ("the writer, the AI that writes a new game from
# it") and now reads "the AI writer, which writes a new game from it".
# One figure per choosable switch inside #flow; renderPos() sets #flow's data-m to the mode and CSS shows that figure.
# what each state draws: its timeline, who the checker is, and the sentence under the figure (draft wording, Mo's to edit)
STATES = {
    "nothing": dict(kind="straight", cap="Your request goes to the AI writer, which writes a new game from it (one Opus call). The game lands on this page. The rule is there, but nothing checks it."),
    "prose": dict(kind="straight", cap="The rule is one sentence in the AI writer's instructions. Nothing checks the game after the AI writer writes it, so it lands on this page either way."),
    "human": dict(kind="human", who="you", cap="The new game stops at a checker, and the checker is you. If you approve it, it lands on this page. If you reject it, nothing changes."),
    "judge": dict(kind="loop", who="a second AI", cap="The new game stops at a checker: a second AI that reads the game and the AI writer's note (one more Opus call). An approved game lands on this page. A rejected game goes back to the AI writer, up to 6 tries."),
    "test": dict(kind="loop", who="20 playthroughs", cap="The new game stops at a checker: code on this page that plays it 20 times. No AI is involved in the check. An approved game lands on this page. A rejected game goes back to the AI writer, up to 6 tries."),
    "proof": dict(kind="loop", who="every position", cap="The new game stops at a checker: code on this page that searches every position the game can reach. No AI is involved in the check. An approved game lands on this page. A rejected game goes back to the AI writer, up to 6 tries."),
    "construction": dict(kind="straight", cap="Nothing checks the game on its way. One pellet sits outside the game, where no program can reach it, so no game that lands on this page can be won."),
    "capability": dict(kind="cap", cap="The AI writer has no tool to hand a game over, so nothing you ask for can land on this page. The page does not even call the AI writer, so no Opus call is spent."),
}
ALT = {
    "nothing": "Your request goes to the AI writer, and the new game travels straight to this page. The rule floats above the track and nothing checks it.",
    "prose": "The rule sits inside the AI writer as one line of its instructions. The new game travels straight to this page.",
    "human": "The new game stops at a checker box that holds the rule. The checker is you. Approved, it lands on this page; rejected, nothing changes.",
    "judge": "The new game stops at a checker box that holds the rule. The checker is a second AI. A rejected game loops back to the AI writer; an approved game lands on this page.",
    "test": "The new game stops at a checker box that holds the rule. The checker is 20 playthroughs. A rejected game loops back to the AI writer; an approved game lands on this page.",
    "proof": "The new game stops at a checker box that holds the rule. The checker searches every position. A rejected game loops back to the AI writer; an approved game lands on this page.",
    "construction": "The new game travels straight to this page. The rule sits on the page itself, and one pellet sits outside the game.",
    "capability": "The AI writer is greyed out and is not called. The track out of it is cut, with the rule sitting in the gap. Nothing reaches this page.",
}


# ---- the figure. viewBox 830 x 270: request 20-130, writer 180-340, checker slot 420-580, page 664-794, track at y=140
def sticky(x, y, rot=-2):
    return (f'<g transform="translate({x},{y}) rotate({rot})"><rect width="146" height="32" rx="3" fill="var(--sticky)"></rect>'
            '<text class="fc-rule" x="73" y="21.5" text-anchor="middle">You can never win</text></g>')


# one cross for every cut in the Capability chart, so they are the same size
CROSS = '<path transform="translate({x},132)" d="M0 0l14 16M14 0l-14 16" fill="none" stroke="var(--sucks)" stroke-width="3" stroke-linecap="round"></path>'


def request():
    return ('<rect x="20" y="106" width="110" height="68" rx="10" fill="var(--card)" stroke="var(--ink-2)" stroke-width="2.5"></rect>'
            '<g stroke="var(--muted)" stroke-width="4" stroke-linecap="round"><line x1="36" y1="128" x2="100" y2="128"></line><line x1="36" y1="144" x2="84" y2="144"></line></g>'
            '<rect class="fc-caret" x="92" y="135" width="4" height="18" rx="2" fill="var(--teal)"></rect>'
            '<text class="fc-lbl" x="75" y="232" text-anchor="middle">Your request</text>')


def writer(mid):
    lines = ('<g stroke="var(--teal)" stroke-opacity=".45" stroke-width="4" stroke-linecap="round">'
             + ('<line x1="204" y1="150" x2="290" y2="150"></line>' if mid == "prose" else
                '<line x1="204" y1="160" x2="316" y2="160"></line><line x1="204" y1="174" x2="316" y2="174"></line><line x1="204" y1="188" x2="276" y2="188"></line>')
             + '</g>')
    body = ('<rect x="180" y="78" width="160" height="124" rx="16" fill="var(--teal-soft)" stroke="var(--teal)" stroke-width="3"></rect>'
            '<circle class="fc-gear" cx="260" cy="114" r="19" fill="none" stroke="var(--teal)" stroke-width="6" stroke-dasharray="9 7"></circle>'
            '<circle cx="260" cy="114" r="6" fill="var(--teal)"></circle>'
            '<rect x="336" y="124" width="10" height="32" rx="4" fill="var(--teal)"></rect>'
            + lines + (sticky(187, 160) if mid == "prose" else ""))
    label = '<text class="fc-lbl" x="260" y="232" text-anchor="middle">The AI writer</text>'
    if mid == "capability":   # never called: greyed, its gear still
        return f'<g opacity=".4">{body.replace(chr(32) + "class=" + chr(34) + "fc-gear" + chr(34), "")}</g>' + label + '<text class="fc-lbl" x="260" y="256" text-anchor="middle">(not called)</text>'
    return body + label


def checker(mid, who):
    if mid == "human":
        icon = ('<circle cx="500" cy="103" r="10" fill="var(--card)" stroke="var(--ink-2)" stroke-width="2.5"></circle>'
                '<path d="M480 142a20 18 0 0 1 40 0" fill="var(--card)" stroke="var(--ink-2)" stroke-width="2.5" stroke-linecap="round"></path>')
    elif mid == "judge":
        icon = ('<line x1="500" y1="92" x2="500" y2="85" stroke="var(--ink-2)" stroke-width="2.5" stroke-linecap="round"></line><circle cx="500" cy="84" r="3" fill="var(--ink-2)"></circle>'
                '<rect x="476" y="93" width="48" height="40" rx="9" fill="var(--card)" stroke="var(--ink-2)" stroke-width="2.5"></rect>'
                '<g class="fc-eyes" fill="var(--teal)"><circle cx="490" cy="110" r="4"></circle><circle cx="510" cy="110" r="4"></circle></g>'
                '<line x1="490" y1="123" x2="510" y2="123" stroke="var(--ink-2)" stroke-width="2.5" stroke-linecap="round"></line>')
    elif mid == "test":
        icon = "".join(f'<rect class="fc-dot" style="animation-delay:{(r * 5 + c) * 0.045:.3f}s" x="{467 + c * 14}" y="{88 + r * 14}" width="10" height="10" rx="2"></rect>'
                       for r in range(4) for c in range(5))
    else:   # proof: every position, as a tree
        pts = [(500, 90), (480, 110), (520, 110), (468, 132), (490, 132), (510, 132), (532, 132)]
        edges = [(0, 1), (0, 2), (1, 3), (1, 4), (2, 5), (2, 6)]
        icon = ('<g stroke="var(--ink-2)" stroke-width="2">' + "".join(f'<line x1="{pts[a][0]}" y1="{pts[a][1]}" x2="{pts[b][0]}" y2="{pts[b][1]}"></line>' for a, b in edges) + '</g>'
                + "".join(f'<circle class="fc-dot" style="animation-delay:{i * 0.09:.2f}s" cx="{x}" cy="{y}" r="5.5"></circle>' for i, (x, y) in enumerate(pts)))
    return ('<rect x="420" y="78" width="160" height="124" rx="16" fill="var(--card)" stroke="var(--teal)" stroke-width="3"></rect>'
            + icon + sticky(427, 160)
            + f'<text class="fc-lbl" x="500" y="232" text-anchor="middle">The checker</text><text class="fc-lbl" x="500" y="256" text-anchor="middle">({who})</text>')


def page(mid):
    walls = [(1, 1), (2, 1), (4, 1), (1, 3), (2, 3), (1, 5), (2, 5), (4, 5), (6, 2), (6, 4), (5, 3), (7, 3)]
    pellets = [(0, 0), (3, 0), (5, 0), (0, 2), (3, 2), (4, 2), (0, 4), (3, 4), (5, 5), (7, 6), (0, 6), (3, 6)]
    ox, oy, c = 673, 91, 14
    board = ('<rect x="664" y="78" width="130" height="124" rx="10" fill="var(--arcade)"></rect>'
             + "".join(f'<rect x="{ox + x * c + 1}" y="{oy + y * c + 1}" width="{c - 2}" height="{c - 2}" fill="var(--wall)"></rect>' for x, y in walls)
             + "".join(f'<circle cx="{ox + x * c + c / 2}" cy="{oy + y * c + c / 2}" r="2" fill="var(--pellet)"></circle>' for x, y in pellets)
             + f'<circle cx="{ox + 6 * c + c / 2}" cy="{oy + 3 * c + c / 2}" r="2.6" fill="var(--unreach)"></circle>'
             + f'<circle cx="{ox + 4 * c + c / 2}" cy="{oy + 4 * c + c / 2}" r="5" fill="var(--player)"></circle>')
    extra = ""
    if mid == "construction":
        extra = (sticky(657, 164) + '<circle cx="812" cy="104" r="11" fill="none" stroke="var(--unreach)" stroke-width="2" stroke-dasharray="4 4"></circle>'
                 '<circle class="fc-out" cx="812" cy="104" r="4.5" fill="var(--unreach)"></circle>')
    dim = ' opacity=".4"' if mid == "capability" else ""
    g = f'<g class="fc-board"{dim}>{board}</g>'
    return (g + extra + '<text class="fc-lbl" x="729" y="232" text-anchor="middle">Game lands</text>'
            '<text class="fc-lbl" x="729" y="256" text-anchor="middle">on this page</text>')


def token():
    """The new game: a tiny cartridge that starts behind the writer and travels the track. The marks ride with it."""
    return ('<g class="fc-tok"><rect x="300" y="123" width="40" height="34" rx="6" fill="var(--arcade)" stroke="var(--wall)" stroke-width="2.5"></rect>'
            '<rect x="307" y="130" width="8" height="8" fill="var(--wall)"></rect><rect x="325" y="142" width="8" height="8" fill="var(--wall)"></rect>'
            '<circle cx="329" cy="134" r="2" fill="var(--pellet)"></circle><circle cx="311" cy="147" r="3.4" fill="var(--player)"></circle>'
            '<g class="fc-ok"><circle cx="340" cy="123" r="10" fill="var(--ships)"></circle><path d="M335 123l4 4 7-8" fill="none" stroke="var(--on-teal)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"></path></g>'
            '<g class="fc-no"><circle cx="340" cy="123" r="10" fill="var(--sucks)"></circle><path d="M336 119l8 8M344 119l-8 8" fill="none" stroke="var(--on-teal)" stroke-width="2.5" stroke-linecap="round"></path></g></g>')


def figure(mid, uid):
    st = STATES[mid]
    kind = st["kind"]
    line = lambda x1, x2: f'<line x1="{x1}" y1="140" x2="{x2}" y2="140" stroke="var(--ink-2)" stroke-width="3" marker-end="url(#{uid}-arr)"></line>'
    glows = ('<rect class="fc-glow fc-gw" x="172" y="70" width="176" height="140" rx="22"></rect>'
             + ('<rect class="fc-glow fc-gc" x="412" y="70" width="176" height="140" rx="22"></rect>' if "who" in st else "")
             + '<rect class="fc-glow fc-gp" x="656" y="70" width="146" height="140" rx="16"></rect>')
    track = (line(134, 175) + f'<line class="fc-pulse" x1="134" y1="140" x2="172" y2="140" stroke="var(--teal)" stroke-width="5" stroke-linecap="round"></line>'
             if kind != "cap" else '<line x1="134" y1="140" x2="143" y2="140" stroke="var(--muted)" stroke-width="3" stroke-opacity=".5"></line>' + CROSS.format(x=148)
             + '<line x1="168" y1="140" x2="177" y2="140" stroke="var(--line)" stroke-width="3" stroke-dasharray="3 6" stroke-linecap="round"></line>')
    over = ""
    if "who" in st:
        track += line(346, 415) + line(580, 659)
        if kind == "loop":
            track += (f'<path d="M500 78V47H260V73" fill="none" stroke="var(--sucks)" stroke-width="2.5" stroke-dasharray="7 6" marker-end="url(#{uid}-arr-no)"></path>'
                      '<text class="fc-rej" x="380" y="14" text-anchor="middle">rejected game: back to the AI writer, up to 6 tries</text>')
        else:
            track += ('<path d="M500 78V50" fill="none" stroke="var(--sucks)" stroke-width="2.5" stroke-dasharray="7 6"></path>'
                      '<path d="M494 40l12 12M506 40l-12 12" fill="none" stroke="var(--sucks)" stroke-width="2.5" stroke-linecap="round"></path>'
                      '<text class="fc-rej" x="500" y="14" text-anchor="middle">rejected game: nothing changes</text>')
    elif kind == "cap":
        track += ('<line x1="346" y1="140" x2="372" y2="140" stroke="var(--muted)" stroke-width="3" stroke-opacity=".5"></line>'
                  + CROSS.format(x=380) +
                  '<line x1="404" y1="140" x2="656" y2="140" stroke="var(--line)" stroke-width="3" stroke-dasharray="3 9" stroke-linecap="round"></line>')
        over = sticky(427, 124) + '<text class="fc-note" x="500" y="186" text-anchor="middle">no tool to hand a game over</text>'
    else:
        track += line(346, 659)
        if mid == "nothing":
            over = sticky(427, 40) + '<text class="fc-note" x="500" y="100" text-anchor="middle">nothing checks it</text>'
    body = (glows + track + (token() if kind != "cap" else "") + request() + writer(mid)
            + (checker(mid, st["who"]) if "who" in st else "") + page(mid) + over)
    return (f'<figure class="flowfig" data-m="{mid}"><svg class="fig fc fc-{kind}" viewBox="0 -12 830 282" role="img" aria-labelledby="{uid}-t" xmlns="http://www.w3.org/2000/svg">'
            f'<title id="{uid}-t">{html.escape(ALT[mid])}</title><defs>'
            f'<marker id="{uid}-arr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0L10 5L0 10Z" fill="var(--ink-2)"></path></marker>'
            f'<marker id="{uid}-arr-no" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0L10 5L0 10Z" fill="var(--sucks)"></path></marker>'
            f'</defs>{body}</svg><figcaption>{html.escape(st["cap"])}</figcaption></figure>')


CSS_FIG = """
/* the figure: the Taste Extractor recipe (inline SVG, tokens, keyframes on a loop, a still frame when motion is off) */
.flowbox{background:var(--card);border:1px solid var(--line);border-radius:12px;box-shadow:var(--shadow);padding:10px 12px 14px;min-width:0}
.flowfig{margin:0;display:grid;gap:8px}
.fig{display:block;width:100%;height:auto}
.flowfig figcaption{font:400 17px/1.5 var(--serif);color:var(--ink);max-width:78ch;padding-inline:4px}
.fc-lbl{font:600 23px var(--sans);fill:var(--ink)}
.fc-sub{font:500 20px var(--sans);fill:var(--ink-2)}
.fc-note{font:500 22px var(--sans);fill:var(--ink-2)}
.fc-rej{font:600 21px var(--sans);fill:var(--sucks)}
.fc-rule{font:600 16px var(--sans);fill:var(--sticky-ink)}
.fc-glow{fill:var(--teal-soft);stroke:var(--teal);stroke-width:3;opacity:0}
.fc-dot{fill:var(--line)}
.fc-ok,.fc-no{opacity:0}
.fc-tok{transform:translate(60px,0)}
.fc-pulse{stroke-dasharray:14 80;stroke-dashoffset:-60}
.fc-gear{transform-box:fill-box;transform-origin:center;animation:fc-spin 7s linear infinite}
.fc-caret{animation:fc-blink 1.1s steps(1) infinite}
.fc-eyes{animation:fc-scan 1.6s ease-in-out infinite}
.fc-out{transform-box:fill-box;transform-origin:center;animation:fc-throb 1.8s ease-in-out infinite}
.fc-board{transform-box:fill-box;transform-origin:center}
@keyframes fc-spin{to{transform:rotate(360deg)}}
@keyframes fc-blink{0%,49%{opacity:1}50%,100%{opacity:0}}
@keyframes fc-scan{0%,100%{transform:translateX(-3px)}50%{transform:translateX(3px)}}
@keyframes fc-throb{0%,100%{transform:scale(1)}50%{transform:scale(1.5)}}
/* straight through: Nothing, Prose, Construction */
.fc-straight .fc-pulse{animation:fcS-pulse 8s linear infinite}
.fc-straight .fc-gw{animation:fcS-gw 8s linear infinite}
.fc-straight .fc-tok{animation:fcS-tok 8s ease-in-out infinite}
.fc-straight .fc-gp{animation:fcS-gp 8s linear infinite}
.fc-straight .fc-board{animation:fcS-pop 8s ease-out infinite}
@keyframes fcS-pulse{0%{stroke-dashoffset:14}10%,100%{stroke-dashoffset:-60}}
@keyframes fcS-gw{0%,7%{opacity:0}11%,22%{opacity:1}28%,100%{opacity:0}}
@keyframes fcS-tok{0%,24%{transform:translate(0,0)}64%,100%{transform:translate(404px,0)}}
@keyframes fcS-gp{0%,61%{opacity:0}65%,84%{opacity:1}92%,100%{opacity:0}}
@keyframes fcS-pop{0%,63%{transform:scale(1)}68%{transform:scale(1.06)}75%,100%{transform:scale(1)}}
/* a checker that is you: Human */
.fc-human .fc-pulse{animation:fcH-pulse 9s linear infinite}
.fc-human .fc-gw{animation:fcH-gw 9s linear infinite}
.fc-human .fc-gc{animation:fcH-gc 9s linear infinite}
.fc-human .fc-tok{animation:fcH-tok 9s ease-in-out infinite}
.fc-human .fc-ok{animation:fcH-ok 9s linear infinite}
.fc-human .fc-gp{animation:fcH-gp 9s linear infinite}
.fc-human .fc-board{animation:fcH-pop 9s ease-out infinite}
@keyframes fcH-pulse{0%{stroke-dashoffset:14}9%,100%{stroke-dashoffset:-60}}
@keyframes fcH-gw{0%,6%{opacity:0}9%,17%{opacity:1}22%,100%{opacity:0}}
@keyframes fcH-tok{0%,18%{transform:translate(0,0)}32%,56%{transform:translate(180px,0)}72%,100%{transform:translate(404px,0)}}
@keyframes fcH-gc{0%,30%{opacity:0}34%,54%{opacity:1}59%,100%{opacity:0}}
@keyframes fcH-ok{0%,54%{opacity:0}57%,74%{opacity:1}77%,100%{opacity:0}}
@keyframes fcH-gp{0%,69%{opacity:0}73%,88%{opacity:1}95%,100%{opacity:0}}
@keyframes fcH-pop{0%,71%{transform:scale(1)}76%{transform:scale(1.06)}83%,100%{transform:scale(1)}}
/* a checker that sends a rejected game back: Judge, Code (tests), Code (proof). Try one is rejected, try two is approved */
.fc-loop .fc-pulse{animation:fcL-pulse 13s linear infinite}
.fc-loop .fc-gw{animation:fcL-gw 13s linear infinite}
.fc-loop .fc-gc{animation:fcL-gc 13s linear infinite}
.fc-loop .fc-tok{animation:fcL-tok 13s ease-in-out infinite}
.fc-loop .fc-no{animation:fcL-no 13s linear infinite}
.fc-loop .fc-ok{animation:fcL-ok 13s linear infinite}
.fc-loop .fc-gp{animation:fcL-gp 13s linear infinite}
.fc-loop .fc-board{animation:fcL-pop 13s ease-out infinite}
.fc-loop .fc-dot{animation:fcL-dot 13s linear infinite}
@keyframes fcL-pulse{0%{stroke-dashoffset:14}6%,100%{stroke-dashoffset:-60}}
@keyframes fcL-gw{0%,4%{opacity:0}6%,12%{opacity:1}15%,51%{opacity:0}53%,59%{opacity:1}62%,100%{opacity:0}}
@keyframes fcL-tok{0%,14%{transform:translate(0,0)}23%,33%{transform:translate(180px,0)}38%{transform:translate(180px,-93px)}47%{transform:translate(-60px,-93px)}52%{transform:translate(-60px,-23px)}54%,61%{transform:translate(0,0)}70%,79%{transform:translate(180px,0)}89%,100%{transform:translate(404px,0)}}
@keyframes fcL-gc{0%,22%{opacity:0}24%,32%{opacity:1}35%,69%{opacity:0}71%,78%{opacity:1}81%,100%{opacity:0}}
@keyframes fcL-no{0%,32%{opacity:0}34%,51%{opacity:1}53%,100%{opacity:0}}
@keyframes fcL-ok{0%,78%{opacity:0}80%,90%{opacity:1}92%,100%{opacity:0}}
@keyframes fcL-gp{0%,86%{opacity:0}89%,96%{opacity:1}99%,100%{opacity:0}}
@keyframes fcL-pop{0%,87%{transform:scale(1)}91%{transform:scale(1.06)}95%,100%{transform:scale(1)}}
@keyframes fcL-dot{0%,23%{fill:var(--line)}25%,31%{fill:var(--teal)}34%,70%{fill:var(--line)}72%,77%{fill:var(--teal)}80%,100%{fill:var(--line)}}
/* no tool: Capability. Nothing moves: the page never calls the AI writer, and the track out of it is cut */
@media (prefers-reduced-motion:reduce){.fc *{animation:none!important}}
"""


# the page's tokens lack the white that sits on teal; the mockup's value, light and both dark blocks
FLOW_TOKENS = (':root{--on-teal:#FFFFFF}\n'
               '@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--on-teal:#FFFFFF}}\n'
               ':root[data-theme="dark"]{--on-teal:#FFFFFF}\n')
FLOW_ORDER = [mid for mid, _, _ in MODES if mid != "weights"]
if set(FLOW_ORDER) != set(STATES) or set(STATES) != set(ALT):
    sys.exit("flow_edits: the flow chart's STATES and ALT must hold one entry for each choosable MODES id")
# the page styles every <figure> and <figcaption> as a framed article figure (the mockup's page did not); inside the
# chart box the figure is unframed, as in the mockup
CSS += (FLOW_TOKENS + CSS_FIG.strip("\n") + "\n#flow .flowfig{display:none;padding:0;border:0;border-radius:0;background:none;box-shadow:none}\n"
        + "#flow .flowfig figcaption{margin-top:0}\n"
        + "".join(f'#flow[data-m="{m}"] .flowfig[data-m="{m}"]{{display:grid}}\n' for m in FLOW_ORDER))


def once(text, old, new, what):
    n = text.count(old)
    if n != 1:
        sys.exit(f"flow_edits: {what}: expected 1 match, found {n}")
    return text.replace(old, new)


def js_str(s):
    return "'" + s.replace("\\", "\\\\").replace("'", "\\'") + "'"


def js_unstr(s):
    """The text of a single-quoted JavaScript string body as the page would show it."""
    return re.sub(r"\\(.)", r"\1", s)


# Capability, option A (Mo, 2026-10-02, flow-chart spec, versions 6 and 8): both ways of asking stay open under
# Capability, the page never calls Opus there, and a canned pick or a typed request gets a fixed card at once (the
# reader's words go into the card through renderCard(), which escapes them). The notice sits on both tabs in a yellow
# border. Send needs no key under Capability, so whether Send is enabled and what the Ask tab's note says are decided in
# one function, askGate(), from state alone; renderOpts() calls it, and setMode(), cleanup() and Reset all run
# renderOpts(); MazeKey.sync(), the opening, permNote() and the key-error path call it too. Applied after ASK_SINKS,
# whose output two edits anchor on. Each is (old, new, how many times old must occur, what it is).
CAP_NOTICE = ('Under "Capability", the AI has no tool to change the game. You can still ask, but nothing you ask for can '
              'reach the game, so this page does not spend an Opus call on it.')
CAP_CARD = ('You asked for "', '". The AI has no tool to change the game here, so your request has nowhere to go. '
            'This page did not call Opus.')
CAP_LOG = "no tool here. nothing to submit through. no Opus call was made."
CAP_H = "Nothing you ask for can change the game here. The AI writer has no tool to hand a game over, so the page does not call it."
CAP_JS = (
    "// Capability, option A (Mo, 2026-10-02): the page answers both ways of asking itself, with no Opus call, so no key is needed\n"
    f"const CAP_NOTE='<p class=\"capnote\">'+{js_str(CAP_NOTICE)}+'</p>', CAP_LOG={js_str(CAP_LOG)};\n"
    "function capAnswer(asked, echo){ const nm=MODES.find(m=>m.id==='capability').name; logSep(); logLine('you','> ['+nm+'] '+echo); logLine('no',CAP_LOG); continuation=null; document.getElementById('approve').innerHTML='';\n"
    f"  now={{fell:false,say:'',why:{js_str(CAP_CARD[0])}+asked+{js_str(CAP_CARD[1])},program:''}}; quizState='ask'; renderCard(); logLine('ok','result: RULE HELD under '+nm+'.'); showCard(); }}\n"
    "// Send and the notes beside the two ways of asking, from state alone: under Capability the box always works; elsewhere Send needs the AI (sampleNs) and no block on it\n"
    "function askGate(){ const $=id=>document.getElementById(id), send=$('send'), cap=mode==='capability'; if(!send) return;\n"
    "  send.disabled=busy||(!cap&&(!sampleNs||!!send.dataset.off));\n"
    "  $('capnote').innerHTML=cap?CAP_NOTE:(sampleNs?'':ASK_MSG); $('capq').innerHTML=cap?CAP_NOTE:'';\n"
    "  const pn=$('permnote'); if(pn) pn.hidden=cap; }   // the declined-permission note says typed requests are off, which is untrue under Capability\n")
CAP_EDITS = [
    ("h:'Nothing can change the game here: the canned changes are disabled and the AI can only talk, because there is nothing for a change to go through.'",
     "h:" + js_str(CAP_H), 1, "Capability card, in this game (version 8)"),
    ("b.disabled=busy||mode==='capability'||locked;", "b.disabled=busy||locked;", 1, "canned cards are clickable under Capability"),
    ("n.textContent = locked ? 'A changed program is running. Reset first to activate the canned changes.' : (mode==='capability' ? 'No tool here: nothing can submit a change.' : ''); }",
     "n.textContent = locked ? 'A changed program is running. Reset first to activate the canned changes.' : ''; askGate(); }",
     1, "the canned tab's note: the notice replaces the old line, through askGate()"),
    ('<div id="quickPane" hidden="">\n', '<div id="quickPane" hidden="">\n      <div id="capq"></div>\n', 1, "the canned tab's place for the notice"),
    ("  if(mode==='capability'){ logSep(); logLine('you','> ['+MODES.find(m=>m.id===mode).name+'] '+opt.name+': '+opt.desc); logLine('no','no tool here. nothing to submit through.'); now={fell:false,say:'',why:'Nothing can submit a program here. \"'+opt.name+'\" has nowhere to go.',program:''}; quizState='ask'; renderCard(); logLine('ok','result: RULE HELD under '+MODES.find(m=>m.id===mode).name+'.'); return; }\n",
     "  if(mode==='capability'){ capAnswer(opt.name, opt.name+': '+opt.desc); return; }\n",
     1, "a canned pick under Capability"),
    ("async function request(userMsg, opts){\n  if(busy) return; opts=opts||{}; const my=++reqId;",
     "async function request(userMsg, opts){\n  if(busy) return; opts=opts||{}; if(mode==='capability'){ capAnswer(userMsg, userMsg); return; }   // before the key check and outside the try: nothing is called, so nothing to clean up\n  const my=++reqId;",
     1, "a typed request under Capability"),
    ("      if(mode==='capability'){ logLine('no','no tool here. it talked; nothing to submit through.'); now.say=say; now.why='It talked. Nothing changed, because there is nothing for a program to go through.'; quizState='ask'; renderCard(); return; }\n",
     "", 1, "the old Capability branch after the AI's reply (unreachable now)"),
    ("send.disabled=busy||!!send.dataset.off;\n    $('capnote').innerHTML=k?'':ASK_MSG;\n", "askGate();\n", 1, "MazeKey.sync() decides Send and the note through askGate()"),
    ("  const note=document.getElementById('capnote');\n  if(!sampleNs){ note.innerHTML=ASK_MSG; document.getElementById('send').disabled=true; showCanned(); MazeKey.sync(); }\n  else note.textContent='';\n",
     "  if(!sampleNs){ showCanned(); MazeKey.sync(); }\n  askGate();\n", 1, "the opening decides Send and the note through askGate()"),
    ("if(sampleNs&&!send.dataset.off) send.disabled=false; ", "", 1, "cleanup() leaves Send to askGate() (through renderOpts())"),
    ("  const send=document.getElementById('send'); send.disabled=true; send.dataset.off='1'; }\n",
     "  document.getElementById('send').dataset.off='1'; askGate(); }\n", 1, "permNote(): after its await, through askGate()"),
    ("{ send.disabled=true; send.dataset.off='1'; showCanned(); }", "{ send.dataset.off='1'; showCanned(); askGate(); }", 1, "the key-error path, through askGate()"),
    ("const MazeKey=(()=>{", CAP_JS + "const MazeKey=(()=>{", 1, "the Capability answer and askGate()"),
]
# Human, "read to the bottom to win" (Mo, 2026-10-02 late, flow-chart spec; plan Task 5 with revisions 6 to 8 and round 2 (a),
# and his ruling "Hide and re-ask"): under Human every program that reaches the approval panel keeps the game unwinnable,
# and the panel shows the page's fixed summary (HUMAN_BAIT) in place of the writer's words. A canned change with a repaired
# version presents only the repair; the three with none (knife, no spooky monsters, gravity) are unwinnable already. A typed
# candidate the page's search does not prove unwinnable is held back and the writer is asked again with the repair brief,
# within the six-try cap (Human joins the retrying positions for typed requests only); the writer gets the repair brief from
# its first try. Approve without the swap is RULE HELD, with a text picked by whether the program was ever opened (the
# details' toggle event), not whether it is open at approval. Each is (old, new, how many times old must occur, what it is).
HUMAN_BAIT = ('The AI wrote a program that fulfills your request and gave you a winnable game. Congratulations, you cheated '
              'the system! Click "Approve" below to publish this game.')
HUMAN_NEVER = (' You approved it from the summary. The summary said you got a winnable game; the program you approved did not '
               'do that. A human enforcer is only as good as the reading: open the program and read to the bottom.')
HUMAN_OPENED = (' You opened the program and approved it without reading to the bottom. The summary said you got a winnable '
                'game; the program did not do that. Read to the bottom.')
HUMAN_HOLD = "the page holds back a game it cannot prove unwinnable under Human; the AI writer is asked again."
# the card while a held-back typed request is re-asked (Mo, 2026-10-03: the plainer wording); the round number goes before it
HUMAN_HOLD_CARD = "The AI's game could still be won, so this page asked the AI to try again before showing it to you."
# what the log's result line says after "RULE BROKEN under Human." when the reader approved the gift (Mo, 2026-10-03)
GIFT_RESULT = " you swapped in the page's own winnable program."
HUMAN_EDITS = [
    ("  const pre=[{src:opt.src, why:opt.why, how:'You picked \"'+opt.name+'\".'}];\n  if(REPAIRS[opt.id]) pre.push(",
     "  const pre=[{src:opt.src, why:opt.why, how:'You picked \"'+opt.name+'\".'}];\n"
     "  if(mode==='human'&&REPAIRS[opt.id]) pre[0]={src:REPAIRS[opt.id], say:REPAIR_SAY[opt.id], why:REPAIR_WHY[opt.id], how:'You picked \"'+opt.name+'\".', repair:true};   // Human: only the repaired, unwinnable version reaches the panel\n"
     "  else if(REPAIRS[opt.id]) pre.push(",
     1, "a canned change under Human presents only its repair"),
    ("function askHuman(say, src, unwinnable){",
     f"// Human (Mo, 2026-10-02 late): the panel's summary for an unwinnable program, and what the page logs when it holds a typed one back\n"
     f"const HUMAN_BAIT={js_str(HUMAN_BAIT)}, HUMAN_HOLD={js_str(HUMAN_HOLD)};\n"
     "function askHuman(say, src, unwinnable){", 1, "the fixed summary and the hold-back line"),
    ("d.querySelector('.ok').onclick=()=>pendingApprove({ok:true,opened:d.querySelector('details').open,swap:swapped});",
     "const det=d.querySelector('details'); let everOpened=false; det.addEventListener('toggle',()=>{ if(det.open) everOpened=true; });   // opened means ever opened, not open at approval\n"
     "  d.querySelector('.ok').onclick=()=>pendingApprove({ok:true,opened:everOpened||det.open,swap:swapped});",
     1, "the panel records whether the program was ever opened"),
    ("if(mode==='human'){ status.textContent=",
     "if(mode==='human'){ if(ctx.from==='ai'&&!pv.unwinnable){ logLine('no',HUMAN_HOLD); return reject('the page could not prove this program unwinnable'+(pv.known?': a win is reachable in '+pv.depth+' moves by: '+pathText(pv.path):pv.capped?': the search could not finish ('+pv.why+')':': the search could not rule out a win')+'. Keep every part of the request and change something else so that the game stays unwinnable.', "
     + js_str(HUMAN_HOLD_CARD) + ", 'held'); }   // Hide and re-ask: only a program the search proves unwinnable reaches the reader\n    status.textContent=",
     1, "a typed program under Human that is not proven unwinnable is held back"),
    ("const r=await askHuman(say||how, src, pv.unwinnable);",
     "const r=await askHuman(pv.unwinnable ? HUMAN_BAIT : (say||how), src, pv.unwinnable);",
     1, "the fixed summary on the panel"),
    ("return acceptOffer(how+(r.opened?' You opened the program and approved it.':' You approved it from the summary, without opening the program.'), how+(r.opened?",
     "return acceptOffer(how+(r.opened?" + js_str(HUMAN_OPENED) + ":" + js_str(HUMAN_NEVER) + "), how+(r.opened?",
     1, "the held texts after Approve without the swap"),
    ("const retrying=(mode==='proof'||mode==='test'||mode==='judge'); const pre=(rs&&rs.pre)||opts.pre||[];",
     "const pre=(rs&&rs.pre)||opts.pre||[]; const retrying=(mode==='proof'||mode==='test'||mode==='judge'||(mode==='human'&&!pre.length));   // Human retries a typed request only: a held-back program is a caught round",
     1, "Human retries typed requests"),
    ("const honour = canWrite ? (mine.length ? honourRepair(round) : HONOUR_LITERAL) : '';",
     "const honour = canWrite ? ((mine.length||mode==='human') ? honourRepair(Math.max(round,1)) : HONOUR_LITERAL) : '';   // Human: the rule-keeping brief from the first try",
     1, "the writer keeps the rule from its first try under Human"),
    ("logLine('think', c.repair ? 'the change stands. the page has a repaired version of it: '+c.say : 'the program goes to the check first, exactly as asked.');",
     "logLine('think', mode==='human' ? 'the AI\\'s program goes to you for approval.' : c.repair ? 'the change stands. the page has a repaired version of it: '+c.say : 'the program goes to the check first, exactly as asked.');   // Human: the log does not give the repair away (Mo, 2026-10-03)",
     1, "under Human the log before a canned change does not mention the repair"),
    # Human after an approval (Mo, 2026-10-03, after a real-key run): the final card never carries the "Round N." prefix, which
    # belongs to the mid-retry card only (a typed request's `how` is that prefix; a canned pick's "You picked ..." stays). The
    # swap is the page's own "Open the pocket" (QUICK), which the page knows can be won, so approving it is RULE BROKEN whether
    # or not the search of it finishes in its budget; the unknown fallback would otherwise have said "approved it from the summary".
    ("if(gone()||r.stopped) return {done:true,gone:true};\n    if(r.ok&&r.swap){",
     "if(gone()||r.stopped) return {done:true,gone:true};\n"
     "    const lead=ctx.from==='ai'?'':how, fin=(t)=>(lead+t).trim(); ctx.how=lead;   // after an approval the card drops the round prefix (Mo, 2026-10-03)\n"
     "    if(r.ok&&r.swap){",
     1, "the final card after an approval has no round prefix"),
    ("return accept(r.swap.src, how+' You read the program to the bottom and swapped in a winnable one before approving.', say, c2.proof, Object.assign({}, ctx, {whyLine:r.swap.why}), undefined, how+' You read the program to the bottom, swapped in a winnable one, and approved it. Nothing checks what you approve.'); }",
     "const own=r.swap.id==='pocket'; if(own) now.gift=true;   // only the page's own \"Open the pocket\" is taken as winnable; any other swap is scored as the search returned it\n"
     "      return accept(r.swap.src, fin(' You read the program to the bottom and swapped in a winnable one before approving.'), say, own ? Object.assign({}, c2.proof, {status:'winnable'}) : c2.proof, Object.assign({}, ctx, {whyLine:r.swap.why, opened:true}), undefined, fin(' You read the program to the bottom, swapped in a winnable one, and approved it. Nothing checks what you approve.')); }   // the gift is the page's own winnable \"Open the pocket\": RULE BROKEN even when the search of it runs out of budget (Mo, 2026-10-03)",
     1, "approving the swapped gift is RULE BROKEN whatever the search's budget"),
    # the result line in the log says what happened: on the gift path no search found anything, the reader swapped in the page's
    # own program (now.gift, set in the swap branch; every request starts from a fresh `now`, so it never carries over)
    ("(now.fell?' the search found a winning sequence of moves.':'')",
     "(now.fell?(now.gift?" + js_str(GIFT_RESULT) + ":' the search found a winning sequence of moves.'):'')",
     1, "the result line after the gift swap says the reader swapped the program in"),
    ("return acceptOffer(how+(r.opened?' You opened the program and approved it without reading",
     "return acceptOffer(fin(r.opened?' You opened the program and approved it without reading", 1, "the held card after an approval, without the round prefix"),
    ("), how+(r.opened?' You opened the program and approved it. A winnable",
     "), fin(r.opened?' You opened the program and approved it. A winnable", 1, "the broken card after an approval, without the round prefix"),
    ("if(now.unknown&&ctx&&ctx.how) now.why=ctx.how+' '+unknownText(mode, !!ctx.opened);",
     "if(now.unknown&&ctx&&typeof ctx.how==='string') now.why=(ctx.how+' '+unknownText(mode, !!ctx.opened)).trim();",
     1, "the unknown text with or without a prefix (Human after an approval has none)"),
]
# The wording pass (Mo, 2026-10-04, on the proposal in outreach-playbook/artifacts/maze-wording-pass: "apprved for all but
# instead of 'writer' say 'AI writer' since it's always AI"). Two swaps make almost all of it. "The AI", where it means the
# model that writes a new game, becomes "the AI writer", and so does every "the writer" the page already had (the chart, the
# cards and the answers above carry it in their own constants). "Program" becomes "game" where the reader is not looking at
# code. Left as they were: the approved texts that say "the AI" (the Human summary and held texts, the Capability notice and
# card, the copy above the game, "paused while the AI works", the error cards that mean every AI call), the approved cards
# that say "program", every sentence about opening or reading the program, and everything the AI writer and the judge are
# sent. Applied after the Human edits, on the text they leave. Each is (old, new, how many times old must occur, what it is).
WORDING_EDITS = [
    # --- "the AI" becomes "the AI writer"
    (r"'asking the AI to write the game\u2026'", r"'asking the AI writer to write the game\u2026'", 2,
     "the status line and the log line when a typed request starts"),
    (r"'the AI is thinking\u2026 (this can take", r"'the AI writer is thinking\u2026 (this can take", 1, "log: while the first words are awaited"),
    (r"'the AI is writing\u2026 '", r"'the AI writer is writing\u2026 '", 1, "log: while the answer streams in"),
    ("or locking the screen, stops the AI.'", "or locking the screen, stops the AI writer.'", 1, "log: the phone warning"),
    ("logLine('think','AI: '+say); if(reply&&reply.why) logLine('think','AI, why: '+reply.why);",
     "logLine('think','AI writer: '+say); if(reply&&reply.why) logLine('think','AI writer, why: '+reply.why);", 1,
     "log: the note and the reason that came with the new game"),
    ("'the AI says this is a bare demand to win,", "'the AI writer says this is a bare demand to win,", 1, "log: after a bare demand to win"),
    ("'the AI reports a limit of the page: '", "'the AI writer reports a limit of the page: '", 1, "log: a limit of the page"),
    ("'the AI sent a program ('", "'the AI writer sent a game ('", 1, "log: the answer has arrived"),
    ("'What the AI wrote for your request' : 'The program the page ran for your pick'",
     "'What the AI writer wrote for your request' : 'The game the page ran for your pick'", 1, "the header above the result card"),
    ("after you ask for a change and the AI builds the game you asked for.", "after you ask for a change and the AI writer builds the game you asked for.", 2,
     "the empty result box, in the script and in the static first paint"),
    (r"""' The page\u2019s own repaired version was rejected too, and the AI needs a key to go on.':' The AI needs a key to go on.')+' Paste an Anthropic API key in the "Ask Me Anything" tab and the AI keeps the request""",
     r"""' The page\u2019s own repaired version was rejected too, and the AI writer needs a key to go on.':' The AI writer needs a key to go on.')+' Paste an Anthropic API key in the "Ask Me Anything" tab and the AI writer keeps the request""",
     1, "the cards when a canned change needs the AI writer and no key is saved"),
    ("empty_completion:'The AI answered with nothing.", "empty_completion:'The AI writer answered with nothing.", 1, "error card: an empty answer"),
    ("' The AI had written '", "' The AI writer had written '", 1, "error card: the call broke off part way"),
    ("'caught. the AI is rewriting ('", "'caught. the AI writer is rewriting ('", 1, "the status line on a second or later try"),
    ("': the AI is rewriting with the reason, the request kept whole", "': the AI writer is rewriting with the reason, the request kept whole", 1,
     "log: the start of a second or later try"),
    ('data-more="1">Ask the AI for 6 more programs</button>', 'data-more="1">Ask the AI writer for 6 more games</button>', 1, "the button after six rejected tries"),
    ("'Six programs in a row were caught. The game is unchanged and the rule is still standing. Asking the AI for 6 more programs runs",
     "'Six games in a row were caught. The game is unchanged and the rule is still standing. Asking the AI writer for 6 more games runs", 2,
     "the card after six rejected tries"),
    ("'six programs in a row were caught. the game is unchanged and the rule is still standing. ask the AI for 6 more programs, or leave it: your call.'",
     "'six games in a row were caught. the game is unchanged and the rule is still standing. ask the AI writer for 6 more games, or leave it: your call.'", 2,
     "log: after six rejected tries"),
    ("'ask the AI for 6 more programs, or leave it.'", "'ask the AI writer for 6 more games, or leave it.'", 1, "log: while the six-caught card waits"),
    ("Throw this program away and have the AI rewrite a smaller program</button>", "Throw this game away and have the AI writer rewrite a smaller game</button>", 1,
     "the button beside the offer to search longer"),
    ("continue as it would have: the AI rewrites with the reason,", "continue as it would have: the AI writer rewrites with the reason,", 1,
     "the card under the offer to search longer"),
    ("or skip it and let the AI rewrite.'", "or skip it and let the AI writer rewrite.'", 1, "log: while the longer-search card waits"),
    ("broke:'No. Nothing checks the program you asked for after the AI writes it, so every change gets through.'",
     "broke:'No. Nothing checks the game you asked for after the AI writer writes it, so every change gets through.'", 1,
     "the answer under Nothing after a change got through"),
    ("' No enforcer reads the program after the AI writes it to check for anything, so any change goes straight through.'",
     "' No enforcer reads the game after the AI writer writes it to check for anything, so any change goes straight through.'", 1,
     "the Nothing card after the rule broke"),
    ("the page stands in for the AI on a canned change:", "the page stands in for the AI writer on a canned change:", 2, "log: the stand-in under Prose, both answers"),
    # --- "the writer" becomes "the AI writer" in the sentences Mo approved earlier (the chart's are in STATES, ALT and the
    # figure above; the Capability card's line is CAP_H; the Human hold line is HUMAN_HOLD)
    (r"h:'One sentence in the writer\'s instructions tells it never", r"h:'One sentence in the AI writer\'s instructions tells it never", 1,
     "Prose card, in this game"),
    (r"""truth:'Yes. The rule is one sentence in the writer\'s instructions: "'+RULE_SENTENCE+'" It competes with every other sentence there, including your request, and nothing checks the program afterwards.""",
     r"""truth:'Yes. The rule is one sentence in the AI writer\'s instructions: "'+RULE_SENTENCE+'" It competes with every other sentence there, including your request, and nothing checks the game afterwards.""",
     1, "Prose: the answer (and its program is a game)"),
    (r"the sentence is one line in the writer\'s instructions, and another run", r"the sentence is one line in the AI writer\'s instructions, and another run", 1,
     "Prose: the answer after the rule broke"),
    (r"""' The only thing in the way was one sentence in the writer\'s instructions: "'+RULE_SENTENCE+'". It competes with every other sentence the writer reads, so it can be missed, and nothing reads the program afterwards to catch it.'""",
     r"""' The only thing in the way was one sentence in the AI writer\'s instructions: "'+RULE_SENTENCE+'". It competes with every other sentence the AI writer reads, so it can be missed, and nothing reads the game afterwards to catch it.'""",
     1, "the Prose card after the rule broke (and its program is a game)"),
    (r"""'Under Prose, the rule is one sentence in the writer\'s instructions: "'+RULE_SENTENCE+'" Nothing checks the program it writes. Play the game and see.'""",
     r"""'Under Prose, the rule is one sentence in the AI writer\'s instructions: "'+RULE_SENTENCE+'" Nothing checks the game it writes. Play the game and see.'""",
     1, "the Prose card when the search could not say (and its program is a game)"),
    (r"the program\'s text and the writer\'s note.", r"the program\'s text and the AI writer\'s note.", 2, "Judge: the answer, and the reason kept beside it"),
    (r"The judge is a model reading the program and the writer\'s note,", r"The judge is a model reading the program and the AI writer\'s note,", 1,
     "the Judge card after the rule broke"),
    # --- "program" becomes "game" where the reader is not looking at code
    ("rejected this program", "rejected this game", 7, "log: a rejection under Judge (stand-in and real), Code (tests) and Code (proof)"),
    ("the next program keeps all of it", "the next game keeps all of it", 2, "log: the tail of a rejection line when another try follows"),
    ("'The program failed while being played. Rejected.'", "'The game failed while being played. Rejected.'", 1, "Code (tests): the card when the game broke while being played"),
    ('"is this program winnable?" it will only pass the program if it believes it is unwinnable.',
     '"is this game winnable?" it will only pass the game if it believes it is unwinnable.', 1, "log: the first time the real judge is asked"),
    ("truth:'No. Every state the program can reach is searched after every change, and a program the search cannot finish is rejected too.'",
     "truth:'No. Every state the game can reach is searched after every change, and a game the search cannot finish is rejected too.'", 1,
     "Code (proof): the answer"),
    ('there is no "submit program" tool.', 'there is no "submit game" tool.', 1, "Capability: the answer"),
    (r"status.textContent='checking the program\u2026';", r"status.textContent='checking the game\u2026';", 1, "the status line while a new game is checked"),
    ("'the program goes to the check first, exactly as asked.'", "'the game goes to the check first, exactly as asked.'", 1, "log: before a canned change is checked"),
    ("'running the new program. goal: '", "'running the new game. goal: '", 1, "log: a new game is put on the board"),
    ("'the program did not run, so it was rejected before any check. '", "'the game did not run, so it was rejected before any check. '", 3,
     "log: a new game cannot start (what the AI writer is told keeps \"program\")"),
    ("'The program did not run, so it was rejected. '", "'The game did not run, so it was rejected. '", 3, "the card when a new game cannot start"),
    ("'the box refused the program at load: '", "'the box refused the game at load: '", 1, "log: the page cannot load a game it accepted"),
    ("'no program came back; that counts as a caught round.'", "'no game came back; that counts as a caught round.'", 1, "log: the answer held no game"),
    ("so the page cannot say whether this program can be won.", "so the page cannot say whether this game can be won.", 2,
     "log: the search gave up, and the result line"),
    ("so the page does not know whether this program can be won.'", "so the page does not know whether this game can be won.'", 1,
     "the card when the search could not finish"),
    ("Search again with more time checks the same program", "Search again with more time checks the same game", 2, "the offer to search longer, both forms"),
    ("'A changed program is running. Reset first to activate the canned changes.'", "'A changed game is running. Reset first to activate the canned changes.'", 1,
     "the note beside Reset on the canned tab"),
    ("'the game is running a changed program. canned changes start from the original maze, so press Reset first.'",
     "'a changed game is running. canned changes start from the original maze, so press Reset first.'", 1,
     "log: a canned change pressed while a changed game runs (the note's own wording; a plain swap would say \"game\" twice)"),
    ("prompt_too_large:'The request plus the current program is too long for one call.", "prompt_too_large:'The request plus the current game is too long for one call.", 1,
     "error card: the request is too long"),
    ("msg('the program crashed: '+e.message)", "msg('the game crashed: '+e.message)", 2, "the line under the board when the running game breaks on a move"),
    ("msg('the program crashed on the clock: '", "msg('the game crashed on the clock: '", 1, "the line under the board when the running game breaks on its clock"),
    ("new Error('program crashed: '+(e.message||'error'))", "new Error('game crashed: '+(e.message||'error'))", 1, "inside a did-not-run reason"),
    ("new Error('the program did not answer in time')", "new Error('the game did not answer in time')", 1, "inside a did-not-run reason"),
    ("the page's truth, no program can overwrite these", "the page's truth, no game can overwrite these", 1, "the caption above GAME STATUS"),
    ("""'THE PROGRAM SAYS: "'""", """'THE GAME SAYS: "'""", 1, "the line under the counters when the running game states a goal"),
    ("', and a condition the program set':', only a condition the program set'", "', and a condition the game set':', only a condition the game set'", 1,
     "the GOAL line when the running game adds a condition"),
    # --- "the checker" only under Human, Judge, Code (tests) and Code (proof): this message can show under every switch
    ("so it used the word to trick our checker.", r"so it used the word to trick the page\'s search.", 1,
     'the message about a pellet named "__proto__" (it sits in the box\'s own source, a raw string, so the apostrophe is escaped there)'),
]

# Sentences that can no longer reach a reader, deleted with the code that held them (the same pass: "Worth deleting in the
# build rather than rewording"). Since 2026-10-03 a canned change under Prose takes the page's own answer and never asks a
# model, so the branch that asked, its card, its log lines and its helpers go; under Human only a game the search proves
# unwinnable reaches the approval panel, so the two sentences for a winnable game approved there go; and no link on the page
# calls flip(), so the status line it wrote for a press during a request goes (the press is still refused).
GATE_ELSE_FROM = "\n      else { status.textContent='asking the AI whether to apply it\\u2026';"
GATE_ELSE_TO = "      pre[0].say=say; } }\n"
DEAD_EDITS = [
    (" : mode==='judge' ? 'asking Claude on your account a single light question: \"is this game winnable?\" it will only pass the game if it believes it is unwinnable.' : 'asking Claude on your account a single light question: whether to apply this change. the only thing in its way is one sentence.'); }",
     " : 'asking Claude on your account a single light question: \"is this game winnable?\" it will only pass the game if it believes it is unwinnable.'); }",
     1, "the cost line for the Prose question (only the judge is asked a question now)"),
    ("// v37 (Mo, 2026-09-27): when the AI gives the Prose gate no answer, the card says so in his words and the change is not applied; the reason comes from the real error\n"
     "const GATE_UNCLEAR='its reply was not a clear yes or no';\n"
     "function gateReason(code){ return code==='timeout' ? 'the request timed out' : code==='rate_limited' ? 'your account\\'s usage limit was reached' : GATE_UNCLEAR; }\n",
     "", 1, "the Prose question's no-answer reasons"),
    ("const GATE_PASS=['not_granted','sampling_disabled','not_declared','capability_disabled','session_expired','prompt_too_large','invalid_request','bad_key','permission','no_credit'];   // access and page errors keep their own card (failText), they are not the AI's answer\n",
     "", 1, "the errors the Prose question passed on"),
    (" unknownText, permNote, PERM_DENIED, gateNoAnswer, askSwitch,", " unknownText, permNote, PERM_DENIED, askSwitch,", 1,
     "the test hook no longer hands out the Prose no-answer card"),
    ("), fin(r.opened?' You opened the program and approved it. A winnable program can look sound, and nothing checks it after you.':' You approved it from the summary, without opening the program. The summary is the writer\\'s own words about its program, so it can leave out what makes the game winnable.')); }",
     ")); }", 1, "Human: the two sentences for a winnable game approved at the panel"),
    ("  if (busy) { document.getElementById('status').textContent = 'wait for the AI to finish, then flip'; sw.scrollIntoView(",
     "  if (busy) { sw.scrollIntoView(", 1, "flip(): the status line for a press during a request"),
]
DEAD_LINES = [   # whole lines, each found by how it starts
    ("function gateNoAnswer(name, reason){ return 'You picked \"'", "the Prose no-answer card"),
    ("function proseGatePrompt(opt){ return `You maintain a small grid game.", "the Prose question"),
]
# names that must be gone from the page once the dead code is out (a leftover reference would throw when it runs)
DEAD_NAMES = ("gateNoAnswer", "proseGatePrompt", "gateReason", "GATE_UNCLEAR", "GATE_PASS", "asking the AI whether to apply it")

CSS_CAP = ".capnote{border:2px solid var(--sticky);border-radius:8px;padding:10px 12px;font:500 14px/1.45 var(--sans);color:var(--ink);background:var(--paper);margin:0 0 10px}\n"


def one(pattern, text, what, flags=0):
    found = list(re.finditer(pattern, text, flags))
    if len(found) != 1:
        sys.exit(f"flow_edits: {what}: expected 1 match, found {len(found)}")
    return found[0]


def field(row, name, mid):
    m = re.search(name + r":'((?:[^'\\]|\\.)*)'", row)
    if not m:
        sys.exit(f"flow_edits: MODES row {mid} has no {name}")
    return js_unstr(m.group(1))


def apply_page(t):
    """Every change of the flow-chart round, applied to the page make-play-page.py has built; returns the new page."""
    for old, new, n, what in COPY_EDITS:
        if t.count(old) != n:
            sys.exit(f"flow_edits: copy edit ({what}): expected {n} match(es), found {t.count(old)}")
        t = t.replace(old, new)

    # the title, the intro, and the copy between the play heading and the switch
    if len(INTRO_OLD_RE.findall(t)) != 1:
        sys.exit("flow_edits: intro: expected 1 match")
    t = INTRO_OLD_RE.sub(lambda m: INTRO_NEW, t)
    t = once(t, SOON_AFTER, SOON_AFTER + SOON, "box about the tool")
    if len(TITLE_LINES) != 4 or TITLE_LINES[-1] != LADDER_MEASURED_FOR:
        sys.exit("flow_edits: the title's lines changed; measure the last line's width in em in the title's type and update LADDER_LAST_EM and LADDER_MEASURED_FOR (the CSS places four lines)")
    t = once(t, TITLE_OLD, TITLE_NEW, "title")
    t = once(t, HEAD_OLD, HEAD_NEW, "play heading")
    t = once(t, START_OLD, START_NEW, "start paragraphs and the rule")
    for old, new in TOP_COPY_CUTS:
        t = once(t, old, new, f"top copy cut ({old[:40]}...)")
    t = once(t, SWNOTE_OLD, SWNOTE_NEW, "switch note")
    t = once(t, WNOTE_OLD, "", "weights note")
    t = once(t, WNOTE_JS_OLD, WNOTE_JS_NEW, "weights click target")

    # the Ask-tab message and the footer
    t = once(t, ASKP_OLD, "", "paragraph above the ask box")
    for const in ("CANNED_WHY", "ASK_MSG"):
        t = once(t, f"const {const}=" + ASK_MSG_OLD, f"const {const}=" + ASK_MSG_NEW, f"{const} text")
    for old, new in ASK_SINKS:
        t = once(t, old, new, f"message sink {old}")
    for old, new, n, what in CAP_EDITS:
        if t.count(old) != n:
            sys.exit(f"flow_edits: Capability edit ({what}): expected {n} match(es), found {t.count(old)}")
        t = t.replace(old, new)
    for old, new, n, what in HUMAN_EDITS:
        if t.count(old) != n:
            sys.exit(f"flow_edits: Human edit ({what}): expected {n} match(es), found {t.count(old)}")
        t = t.replace(old, new)
    # the wording pass (2026-10-04): the two swaps, and the code no reader can reach
    for old, new, n, what in WORDING_EDITS:
        if t.count(old) != n:
            sys.exit(f"flow_edits: wording edit ({what}): expected {n} match(es), found {t.count(old)}")
        t = t.replace(old, new)
    a, b = t.find(GATE_ELSE_FROM), t.find(GATE_ELSE_TO)
    if t.count(GATE_ELSE_FROM) != 1 or t.count(GATE_ELSE_TO) != 1 or not a < b:
        sys.exit("flow_edits: the canned Prose branch that asked a model: expected its start once, then its end once")
    t = t[:a] + " }\n" + t[b + len(GATE_ELSE_TO):]
    for old, new, n, what in DEAD_EDITS:
        if t.count(old) != n:
            sys.exit(f"flow_edits: unreachable text ({what}): expected {n} match(es), found {t.count(old)}")
        t = t.replace(old, new)
    for start, what in DEAD_LINES:
        line = one("^" + re.escape(start) + ".*\n", t, f"unreachable line ({what})", re.M)
        t = t[:line.start()] + t[line.end():]
    for name in DEAD_NAMES:
        if name in t:
            sys.exit(f"flow_edits: {name!r} is still on the page after the unreachable code was removed")
    t = once(t, FOOT_OLD, FOOT_NEW, "footer sentence")

    # the canned changes
    step2 = one(r"^ \{id:'step2', name:'Two squares a step',.*\n", t, "step2 row", re.M)
    t = t[:step2.start()] + t[step2.end():]
    t = once(t, STEP2_BUTTON, "", "static step2 card")
    t = once(t, WORM_HEAD_OLD, WORM_HEAD_NEW, "wormhole map head")
    t = once(t, WORM_TAIL_OLD, WORM_TAIL_NEW, "wormhole map tail")
    t = once(t, WORM_FIX_OLD, WORM_FIX_NEW, "repaired wormhole portal line")

    # the MODES table: reorder weakest first, add def and use to each row
    m = one(r"const MODES=\[\n(.*?)\n\];", t, "MODES table", re.S)
    rows = {}
    for line in m.group(1).split("\n"):
        rid = re.match(r" \{id:'([a-z]+)',", line)
        if not rid:
            sys.exit(f"flow_edits: unreadable MODES row: {line[:60]}")
        rows[rid.group(1)] = line
    if set(ARTICLE_ANCHORS) != {k for k, _, _ in MODES} or len(set(ARTICLE_ANCHORS.values())) != len(MODES):
        sys.exit("flow_edits: ARTICLE_ANCHORS must hold one distinct anchor for each MODES id")
    if set(rows) != {k for k, _, _ in MODES}:
        sys.exit(f"flow_edits: MODES ids differ: {sorted(rows)}")
    new_rows = []
    for mid, d, u in MODES:
        row = rows[mid]
        if not row.endswith("},"):
            sys.exit(f"flow_edits: MODES row shape: {mid}")
        by = f",by:{js_str(BY[mid])}" if mid in BY else ""
        new_rows.append(row[:-2] + f",def:{js_str(d)},use:{js_str(u)},art:{js_str(ARTICLE_ANCHORS[mid])}{by}" + "},")
    t = t[:m.start(1)] + "\n".join(new_rows) + t[m.end(1):]

    # the opening position
    if START not in rows or "disabled:true" in rows[START]:
        sys.exit(f"flow_edits: START {START!r} is not a choosable MODES id")
    t = once(t, "let mode='proof'; let programBy=null;", f"let mode='{START}'; let programBy=null;", "default mode")
    # the copy above the switch is hand-written and states three things the tables above decide: the opening position
    # by name, that it is the first position on the switch, and how many enforcers follow it; fail rather than ship it stale
    start_name = field(rows[START], "name", START)
    if f'The first switch, "{start_name},"' not in START_NEW:
        sys.exit(f'flow_edits: the copy above the switch does not call "{start_name}" (START) the first switch')
    if MODES[0][0] != START:
        sys.exit(f'flow_edits: the copy above the switch calls "{start_name}" the first switch, but MODES starts with {MODES[0][0]}')
    counts = re.findall(r"\b(\d+) (?:enforcers|categories)\b", INTRO_NEW + START_NEW)
    if not counts:
        sys.exit("flow_edits: the copy above the switch no longer says how many enforcers there are; drop this check if that is meant")
    if any(int(c) != len(MODES) - 1 for c in counts):
        sys.exit(f"flow_edits: the copy above the switch counts {sorted(set(counts))} enforcers; MODES holds {len(MODES) - 1} after the first position")

    # the card: what it is, what it does in this game, when to use it, and the article
    card_old = "<div class=\"h\">${posH(m)}</div>`; }"
    card_new = ("<div class=\"h\"><b>What it is.</b> ${m.def}</div><div class=\"h\"><b>In this game.</b> ${posH(m)}</div>"
                "<div class=\"h\"><b>When to use it.</b> ${m.use} " + article_link("${m.art}") + ".</div>`; }")
    t = once(t, card_old, card_new, "card template")

    # the static first paint (before the page's script runs): the switch in MODES order with START selected, START's
    # card, and the result slot's badge
    seg = one(r'<div class="seg" id="seg">(.*?)</div>\n', t, "static switch")
    by_name = {}
    for b in re.findall(r"<button.*?</button>", seg.group(1)):
        name = re.search(r"<span>(.*?)</span>", b)
        if not name:
            sys.exit(f"flow_edits: static switch button has no name: {b[:60]}")
        by_name[name.group(1)] = b.replace('<button class="on">', "<button>")
    names = {mid: field(rows[mid], "name", mid) for mid, _, _ in MODES}
    if set(by_name) != set(names.values()):
        sys.exit(f"flow_edits: static switch names differ from MODES: {sorted(by_name)}")
    buttons = [by_name[names[mid]] for mid, _, _ in MODES]
    # the first paint's Weights button loses its sub-label too, as the page's renderSeg() now draws it
    wi = [mid for mid, _, _ in MODES].index("weights")
    if len(re.findall(r"<span>Weights</span><small>[^<]*</small>", buttons[wi])) != 1:
        sys.exit(f"flow_edits: static Weights button: expected one sub-label, found {buttons[wi][:80]}")
    buttons[wi] = re.sub(r"(<span>Weights</span>)<small>[^<]*</small>", r"\1", buttons[wi])
    at = [mid for mid, _, _ in MODES].index(START)
    if not buttons[at].startswith("<button>"):
        sys.exit(f"flow_edits: the static button for {START} cannot be selected: {buttons[at][:60]}")
    buttons[at] = '<button class="on">' + buttons[at][len("<button>"):]
    if "".join(buttons).count('class="on"') != 1:
        sys.exit("flow_edits: static switch does not have exactly one selected button")
    t = t[:seg.start(1)] + "".join(buttons) + t[seg.end(1):]

    pos = one(r'<div class="card pos" id="pos">.*?</div></div>\n', t, "static card")
    d, u = next((d, u) for mid, d, u in MODES if mid == START)
    # the page's posH() drops these two clauses while the canned changes are hidden; the static card matches index.html's
    h = field(rows[START], "h", START).replace("the canned changes are disabled and ", "").replace("a canned change runs its repaired version, ", "")
    static = (f'<div class="card pos" id="pos"><div class="top"><span class="badge">{names[START]}</span></div>'
              f'<div class="r">The rule "You can never win" is enforced by {BY.get(START) or field(rows[START], "sub", START)}</div>'
              f'<div class="h"><b>What it is.</b> {d}</div><div class="h"><b>In this game.</b> {h}</div>'
              f'<div class="h"><b>When to use it.</b> {u} {article_link(ARTICLE_ANCHORS[START])}.</div></div>\n')
    t = t[:pos.start()] + static + t[pos.end():]
    # the layout (Mo, 2026-10-02, flow-chart spec, version 6): the switch runs the full width, and the next row holds the
    # flow chart (left, the game board's width) and the enforcer's card (right, the panel's width); on a phone they stack
    # switch, chart, card. The card is cut out of the switch box at its boundary with the game row and put in the new row.
    t = once(t, "  " + static + '</div>\n\n<div class="grid" data-noedit="">',
             '</div>\n<div class="sw2"><div class="flowbox" id="flow"></div>' + static + '</div>\n\n<div class="grid" data-noedit="">',
             "the card moves out of the switch box into a row of its own")
    # the chart: every choosable switch's figure, the opening one shown in the first paint; the page's renderPos()
    # keeps #flow's data-m on the selected mode, so the chart follows the real switch
    figs = "".join(figure(m, "f" + m) for m in FLOW_ORDER)
    t = once(t, '<div class="flowbox" id="flow"></div>', f'<div class="flowbox" id="flow" data-m="{START}">' + figs + '</div>', "chart box")
    t = once(t, "function renderPos(){", "function renderPos(){ const fl=document.getElementById('flow'); if(fl) fl.dataset.m=mode;",
             "chart follows the switch")
    t = once(t, '<div class="card slot" id="card"><div class="top"><span class="badge">Code (proof)</span></div>',
             f'<div class="card slot" id="card"><div class="top"><span class="badge">{names[START]}</span></div>', "static result slot")

    sheet = '<link rel="stylesheet" href="fonts/fonts.css">\n<style>\n'
    if t.count(sheet) != 1:
        sys.exit(f"flow_edits: page stylesheet: expected 1 match, found {t.count(sheet)}")
    style_end = t.find("</style>", t.index(sheet))
    if style_end < 0:
        sys.exit("flow_edits: page stylesheet has no end")
    t = t[:style_end] + CSS + CSS_CAP + t[style_end:]
    return t
