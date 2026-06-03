/* ============================================
   LATLOMP PLATFORM — GAMES MODULE
============================================ */

const GAME_DATA = {
  quiz: {
    id: null,
    title: "Quick Quiz Challenge",
    questions: [
      {
        q: "What is the capital of Nigeria?",
        opts: ["Kano", "Lagos", "Abuja", "Ibadan"],
        ans: 2,
      },
      {
        q: "How many states are in Nigeria?",
        opts: ["34", "35", "36", "37"],
        ans: 2,
      },
      {
        q: "What does HTML stand for?",
        opts: [
          "High Text ML",
          "HyperText Markup Language",
          "Home Tool Language",
          "Hyperlink Text Mode",
        ],
        ans: 1,
      },
      {
        q: "In which year did Nigeria gain independence?",
        opts: ["1960", "1963", "1956", "1970"],
        ans: 0,
      },
      { q: "What is 25% of 400?", opts: ["75", "100", "125", "50"], ans: 1 },
      {
        q: "Who wrote Things Fall Apart?",
        opts: [
          "Wole Soyinka",
          "Ben Okri",
          "Chinua Achebe",
          "Ngugi wa Thiong'o",
        ],
        ans: 2,
      },
      {
        q: "What is the currency of Nigeria?",
        opts: ["Dollar", "Pound", "Naira", "Cedis"],
        ans: 2,
      },
      {
        q: "Which planet is closest to the Sun?",
        opts: ["Venus", "Earth", "Mercury", "Mars"],
        ans: 2,
      },
      {
        q: "What is the chemical symbol for Gold?",
        opts: ["Go", "Gd", "Au", "Ag"],
        ans: 2,
      },
      {
        q: "Water boils at what temperature (°C)?",
        opts: ["90°C", "95°C", "98°C", "100°C"],
        ans: 3,
      },
    ],
  },
  math: {
    id: null,
    title: "Math Blitz",
    timePerRound: 60,
    questionsTarget: 20,
  },
  word: {
    id: null,
    title: "Word Challenge",
    words: [
      { word: "ABUJA", hint: "Capital city of Nigeria" },
      { word: "NIGERIA", hint: "Most populous country in Africa" },
      { word: "PHYSICS", hint: "Science of matter and energy" },
      { word: "ENGLISH", hint: "Official language of Nigeria" },
      { word: "COMPUTER", hint: "Electronic device for processing data" },
      { word: "HISTORY", hint: "Study of past events" },
      { word: "BIOLOGY", hint: "Study of living organisms" },
      { word: "ALGEBRA", hint: "Branch of mathematics using symbols" },
      { word: "SCIENCE", hint: "Systematic study of the natural world" },
      { word: "TEACHER", hint: "Person who educates students" },
      { word: "STUDENT", hint: "Person who is learning" },
      { word: "LIBRARY", hint: "Place where books are kept" },
    ],
  },
};

/* ============================================
   GAME STATE
============================================ */
var gameState = {
  currentGame: null,
  score: 0,
  questionIndex: 0,
  timeLeft: 0,
  timerInterval: null,
  answered: false,
  totalCorrect: 0,
  totalAnswered: 0,
  mathQuestion: null,
  wordCurrent: null,
  gameIds: {},
};

/* Word game module-level variables */
var wordList = [];
var wordIndex = 0;
var wordTimer = null;
var wordTimeLeft = 0;
var wordAnswered = false; /* FIX: prevents double-advance race condition */

/* ============================================
   PAGE INIT
============================================ */
document.addEventListener("DOMContentLoaded", async function () {
  /* ---- AUTH GUARD: games require login ---- */
  if (!requireLogin("games.html")) return;

  await loadGameIds();
});

async function loadGameIds() {
  try {
    var res = await apiRequest("/games");
    if (res.ok && res.data.games) {
      res.data.games.forEach(function (g) {
        if (g.type === "quiz") gameState.gameIds.quiz = g._id;
        if (g.type === "mathblitz") gameState.gameIds.math = g._id;
      });

      res.data.games.forEach(function (g) {
        var playsEl = document.getElementById(g.type + "-plays");
        var highEl = document.getElementById(g.type + "-high");
        if (playsEl) playsEl.textContent = g.totalPlays + " plays";
        if (highEl) highEl.textContent = "High: " + g.highScore;
      });
    }
  } catch (e) {
    /* Games work without DB */
  }
}

/* ============================================
   START GAME
============================================ */
function startGame(type) {
  gameState.currentGame = type;
  gameState.score = 0;
  gameState.questionIndex = 0;
  gameState.totalCorrect = 0;
  gameState.totalAnswered = 0;
  gameState.answered = false;

  document.getElementById("gameSelection").style.display = "none";
  document.getElementById("game-" + type).classList.add("active");

  if (type === "quiz") startQuizGame();
  if (type === "math") startMathGame();
  if (type === "word") startWordGame();
}

/* ============================================
   END GAME
============================================ */
async function endGame(type) {
  clearInterval(gameState.timerInterval);
  clearInterval(wordTimer); /* FIX: always clear word timer too */
  wordTimer = null;
  wordAnswered = false;

  var score = gameState.score;
  var gameId = gameState.gameIds[type];

  document.getElementById("game-" + type).classList.remove("active");
  showGameOver(type, score);

  if (gameId) {
    var user = getCurrentUser();
    var saveName = user ? user.name : null;
    try {
      await apiRequest("/games/" + gameId + "/score", "POST", {
        score: score,
        playerName: saveName,
      });
    } catch (e) {
      /* saving failed, not critical */
    }
    loadLeaderboard(type, gameId);
  }
}

/* ============================================
   BACK TO GAME SELECTION
   FIX: now clears wordTimer correctly
============================================ */
function backToGames() {
  clearInterval(gameState.timerInterval);
  clearInterval(wordTimer); /* FIX: was missing — caused ghost timer */
  wordTimer = null;
  wordAnswered = false;

  ["quiz", "math", "word"].forEach(function (t) {
    var iface = document.getElementById("game-" + t);
    var over = document.getElementById("gameover-" + t);
    if (iface) iface.classList.remove("active");
    if (over) over.style.display = "none";
  });

  document.getElementById("gameSelection").style.display = "grid";
}

/* ============================================
   GAME OVER SCREEN
============================================ */
function showGameOver(type, score) {
  var overEl = document.getElementById("gameover-" + type);
  if (!overEl) return;

  var trophies =
    score >= 80 ? "🏆" : score >= 50 ? "🥇" : score >= 30 ? "🎯" : "📚";
  var titles =
    score >= 80
      ? "Excellent!"
      : score >= 50
        ? "Great job!"
        : score >= 30
          ? "Good effort!"
          : "Keep practicing!";

  var subtitle = "";
  if (type === "quiz")
    subtitle =
      "You got " +
      gameState.totalCorrect +
      " out of " +
      GAME_DATA.quiz.questions.length +
      " correct";
  else if (type === "math")
    subtitle =
      "You answered " + gameState.totalAnswered + " questions in 60 seconds";
  else if (type === "word")
    subtitle = "You unscrambled " + gameState.totalCorrect + " words correctly";

  var user = getCurrentUser();
  var saveMsg = !user
    ? '<div style="background:rgba(108,99,255,0.08); border:1px solid rgba(108,99,255,0.2); border-radius:10px; padding:12px 16px; margin-bottom:24px; font-size:13px; color:var(--primary-light);">🔑 Login to save your score to the leaderboard!</div>'
    : '<div style="background:rgba(67,233,123,0.08); border:1px solid rgba(67,233,123,0.2); border-radius:10px; padding:12px 16px; margin-bottom:24px; font-size:13px; color:#43e97b;">✅ Score saved to leaderboard!</div>';

  overEl.innerHTML =
    '<div class="game-over-card">' +
    '<span class="game-over-trophy">' +
    trophies +
    "</span>" +
    '<h2 class="game-over-title">' +
    titles +
    "</h2>" +
    '<div class="game-over-score">' +
    score +
    "</div>" +
    '<p class="game-over-sub">' +
    subtitle +
    "</p>" +
    saveMsg +
    '<div class="game-over-actions">' +
    '<button onclick="backToGames()" style="padding:12px 24px; background:rgba(255,255,255,0.05); border:1px solid var(--border); color:var(--text-secondary); border-radius:10px; font-size:14px; font-weight:700; cursor:pointer; font-family:inherit;">← All Games</button>' +
    "<button onclick=\"startGame('" +
    type +
    '\')" style="padding:12px 24px; background:linear-gradient(135deg,var(--primary),var(--primary-dark)); color:white; border:none; border-radius:10px; font-size:14px; font-weight:700; cursor:pointer; font-family:inherit;">Play Again →</button>' +
    "</div>" +
    "</div>";

  overEl.style.display = "block";
}

/* ============================================
   GAME 1: QUIZ CHALLENGE
============================================ */
function startQuizGame() {
  gameState.score = 0;
  gameState.questionIndex = 0;
  gameState.totalCorrect = 0;
  updateQuizUI();
  renderQuizQuestion();
}

function renderQuizQuestion() {
  var idx = gameState.questionIndex;
  var total = GAME_DATA.quiz.questions.length;

  if (idx >= total) {
    endGame("quiz");
    return;
  }

  var q = GAME_DATA.quiz.questions[idx];
  var letters = ["A", "B", "C", "D"];
  gameState.answered = false;

  document.getElementById("quiz-q-number").textContent =
    "Question " + (idx + 1) + " of " + total;
  document.getElementById("quiz-q-text").textContent = q.q;
  document.getElementById("quiz-feedback").textContent = "";
  document.getElementById("quiz-feedback").className = "game-feedback";

  document.getElementById("quiz-options").innerHTML = q.opts
    .map(function (opt, i) {
      return (
        '<button class="game-option" onclick="answerQuiz(' +
        i +
        ')">' +
        '<span class="game-opt-letter">' +
        letters[i] +
        "</span>" +
        opt +
        "</button>"
      );
    })
    .join("");

  updateQuizUI();
}

function answerQuiz(selected) {
  if (gameState.answered) return;
  gameState.answered = true;
  gameState.totalAnswered++;

  var q = GAME_DATA.quiz.questions[gameState.questionIndex];
  var buttons = document.querySelectorAll("#quiz-options .game-option");
  var feedEl = document.getElementById("quiz-feedback");

  buttons.forEach(function (btn) {
    btn.disabled = true;
  });

  if (selected === q.ans) {
    gameState.score += 10;
    gameState.totalCorrect++;
    buttons[selected].classList.add("correct");
    feedEl.textContent = "✅ Correct! +10 points";
    feedEl.className = "game-feedback feedback-correct";
  } else {
    buttons[selected].classList.add("wrong");
    buttons[q.ans].classList.add("correct");
    feedEl.textContent = "❌ Wrong! Correct answer: " + q.opts[q.ans];
    feedEl.className = "game-feedback feedback-wrong";
  }

  updateQuizUI();

  setTimeout(function () {
    gameState.questionIndex++;
    renderQuizQuestion();
  }, 1500);
}

function updateQuizUI() {
  var scoreEl = document.getElementById("quiz-score");
  if (scoreEl) scoreEl.textContent = "Score: " + gameState.score;
}

/* ============================================
   GAME 2: MATH BLITZ
============================================ */
function startMathGame() {
  gameState.score = 0;
  gameState.totalAnswered = 0;
  gameState.totalCorrect = 0;
  gameState.timeLeft = GAME_DATA.math.timePerRound;

  generateMathQuestion();
  startMathTimer();

  var input = document.getElementById("math-input");
  if (input) {
    input.value = "";
    input.focus();
    input.onkeydown = function (e) {
      if (e.key === "Enter") checkMathAnswer();
    };
  }
}

function generateMathQuestion() {
  var operations = ["+", "-", "×"];
  var op = operations[Math.floor(Math.random() * operations.length)];
  var a, b, answer;

  if (op === "+") {
    a = Math.floor(Math.random() * 50) + 1;
    b = Math.floor(Math.random() * 50) + 1;
    answer = a + b;
  } else if (op === "-") {
    a = Math.floor(Math.random() * 50) + 10;
    b = Math.floor(Math.random() * a) + 1;
    answer = a - b;
  } else {
    a = Math.floor(Math.random() * 12) + 1;
    b = Math.floor(Math.random() * 12) + 1;
    answer = a * b;
  }

  gameState.mathQuestion = { a: a, b: b, op: op, answer: answer };

  var displayEl = document.getElementById("math-display");
  if (displayEl) displayEl.textContent = a + " " + op + " " + b + " = ?";

  var input = document.getElementById("math-input");
  if (input) {
    input.value = "";
    input.focus();
  }

  var feedEl = document.getElementById("math-feedback");
  if (feedEl) {
    feedEl.textContent = "";
    feedEl.className = "game-feedback";
  }
}

function checkMathAnswer() {
  var input = document.getElementById("math-input");
  var feedEl = document.getElementById("math-feedback");
  var entered = parseInt(input.value);

  if (isNaN(entered)) {
    if (feedEl) {
      feedEl.textContent = "⚠️ Please enter a number";
      feedEl.className = "game-feedback feedback-wrong";
    }
    return;
  }

  gameState.totalAnswered++;

  if (entered === gameState.mathQuestion.answer) {
    gameState.score += 5;
    gameState.totalCorrect++;
    if (feedEl) {
      feedEl.textContent = "✅ Correct! +5 points";
      feedEl.className = "game-feedback feedback-correct";
    }
  } else {
    if (feedEl) {
      feedEl.textContent =
        "❌ Wrong! Answer was " + gameState.mathQuestion.answer;
      feedEl.className = "game-feedback feedback-wrong";
    }
  }

  var scoreEl = document.getElementById("math-score");
  if (scoreEl) scoreEl.textContent = "Score: " + gameState.score;

  setTimeout(function () {
    generateMathQuestion();
  }, 600);
}

function startMathTimer() {
  var timerEl = document.getElementById("math-timer");

  gameState.timerInterval = setInterval(function () {
    gameState.timeLeft--;

    if (timerEl) {
      timerEl.textContent = gameState.timeLeft;
      timerEl.className = "game-timer-bar";
      if (gameState.timeLeft <= 5) timerEl.classList.add("danger");
      else if (gameState.timeLeft <= 15) timerEl.classList.add("warning");
    }

    if (gameState.timeLeft <= 0) {
      clearInterval(gameState.timerInterval);
      endGame("math");
    }
  }, 1000);
}

/* ============================================
   GAME 3: WORD CHALLENGE
   FIXED: race condition, timer kill bug,
          double-advance bug
============================================ */
function startWordGame() {
  gameState.score = 0;
  gameState.totalCorrect = 0;

  /* Clear any leftover timers from previous game */
  clearInterval(wordTimer);
  wordTimer = null;

  wordList = GAME_DATA.word.words
    .slice()
    .sort(function () {
      return Math.random() - 0.5;
    })
    .slice(0, 8);
  wordIndex = 0;
  wordAnswered = false;

  showNextWord();
}

function showNextWord() {
  clearInterval(wordTimer);
  wordTimer = null;
  wordAnswered = false; /* FIX: reset flag for each new word */

  if (wordIndex >= wordList.length) {
    endGame("word");
    return;
  }

  var wordObj = wordList[wordIndex];
  var scrambled = scrambleWord(wordObj.word);

  gameState.wordCurrent = wordObj;
  wordTimeLeft = 30;

  document.getElementById("word-scrambled").textContent = scrambled;
  document.getElementById("word-hint").textContent = "Hint: " + wordObj.hint;
  document.getElementById("word-number").textContent =
    "Word " + (wordIndex + 1) + " of " + wordList.length;
  document.getElementById("word-score").textContent =
    "Score: " + gameState.score;
  document.getElementById("word-timer").textContent = wordTimeLeft;
  document.getElementById("word-timer").className = "game-timer-bar";
  document.getElementById("word-input").value = "";
  document.getElementById("word-feedback").textContent = "";
  document.getElementById("word-feedback").className = "game-feedback";
  document.getElementById("word-input").focus();

  /* Capture wordObj and wordIndex for this word's timer closure */
  var capturedWordObj = wordObj;
  var capturedWordIndex = wordIndex;

  wordTimer = setInterval(function () {
    /*
      FIX: If user already answered this word, stop the timer.
      Prevents double-advance if timer fires just after submit.
    */
    if (wordAnswered) {
      clearInterval(wordTimer);
      wordTimer = null;
      return;
    }

    wordTimeLeft--;

    var timerEl = document.getElementById("word-timer");
    if (timerEl) {
      timerEl.textContent = wordTimeLeft;
      timerEl.className = "game-timer-bar";
      if (wordTimeLeft <= 5) timerEl.classList.add("danger");
      else if (wordTimeLeft <= 10) timerEl.classList.add("warning");
    }

    if (wordTimeLeft <= 0) {
      clearInterval(wordTimer);
      wordTimer = null;
      wordAnswered = true; /* FIX: mark answered to block submit race */

      showWordFeedback(false, capturedWordObj.word);

      setTimeout(function () {
        wordIndex++;
        showNextWord();
      }, 1500);
    }
  }, 1000);
}

/*
  FIX: Moved empty-input check BEFORE clearInterval.
  Previously: clearInterval ran first → empty submit killed timer
              → word stuck forever with no countdown
*/
function checkWordAnswer() {
  /* FIX: check for input FIRST before touching the timer */
  var input = document.getElementById("word-input");
  var entered = input ? input.value.trim().toUpperCase() : "";

  if (!entered) return; /* FIX: was AFTER clearInterval — now before */

  /* FIX: prevent double-advance if timer already fired */
  if (wordAnswered) return;
  wordAnswered = true;

  clearInterval(wordTimer);
  wordTimer = null;

  var correct = gameState.wordCurrent
    ? gameState.wordCurrent.word.toUpperCase()
    : "";

  if (entered === correct) {
    gameState.score += 15;
    gameState.totalCorrect++;
    showWordFeedback(true, correct);
  } else {
    showWordFeedback(false, correct);
  }

  var scoreEl = document.getElementById("word-score");
  if (scoreEl) scoreEl.textContent = "Score: " + gameState.score;

  setTimeout(function () {
    wordIndex++;
    showNextWord();
  }, 1800);
}

function showWordFeedback(isCorrect, correctWord) {
  var feedEl = document.getElementById("word-feedback");
  if (!feedEl) return;
  if (isCorrect) {
    feedEl.textContent = "✅ Correct! The word is " + correctWord + " +15 pts";
    feedEl.className = "game-feedback feedback-correct";
  } else {
    feedEl.textContent =
      "❌ " +
      (wordTimeLeft <= 0 ? "Time up! " : "Wrong! ") +
      "The word was: " +
      correctWord;
    feedEl.className = "game-feedback feedback-wrong";
  }
}

function scrambleWord(word) {
  var scrambled;
  var attempts = 0;
  do {
    scrambled = word
      .split("")
      .sort(function () {
        return Math.random() - 0.5;
      })
      .join("");
    attempts++;
  } while (scrambled === word && attempts < 10);
  return scrambled;
}

/* ============================================
   LEADERBOARD
============================================ */
async function loadLeaderboard(type, gameId) {
  if (!gameId) return;

  var res = await apiRequest("/games/" + gameId + "/leaderboard");
  if (!res.ok) return;

  var leaderboard = res.data.leaderboard || [];
  var lbEl = document.getElementById("lb-" + type);
  if (!lbEl) return;

  var rankLabels = ["🥇", "🥈", "🥉"];
  var rankClasses = ["gold", "silver", "bronze", "other"];

  if (leaderboard.length === 0) {
    lbEl.innerHTML =
      '<div class="lb-empty">No scores yet. Be the first to play!</div>';
    return;
  }

  lbEl.innerHTML = leaderboard
    .map(function (entry, i) {
      return (
        '<div class="lb-entry">' +
        '<span class="lb-rank ' +
        rankClasses[Math.min(i, 3)] +
        '">' +
        (i < 3 ? rankLabels[i] : "#" + entry.rank) +
        "</span>" +
        '<span class="lb-name">' +
        entry.userName +
        "</span>" +
        '<span class="lb-score">' +
        entry.score +
        "</span>" +
        '<span class="lb-date">' +
        new Date(entry.playedAt).toLocaleDateString("en-NG", {
          day: "numeric",
          month: "short",
        }) +
        "</span>" +
        "</div>"
      );
    })
    .join("");
}

function switchLeaderboard(type) {
  document.querySelectorAll(".lb-tab").forEach(function (t) {
    t.classList.remove("active");
  });

  var activeTab = document.querySelector('.lb-tab[data-game="' + type + '"]');
  if (activeTab) activeTab.classList.add("active");

  ["quiz", "math", "word"].forEach(function (t) {
    var el = document.getElementById("lb-" + t);
    if (el) el.style.display = t === type ? "block" : "none";
  });

  var gameId = gameState.gameIds[type];
  if (gameId) loadLeaderboard(type, gameId);
}

console.log("🎮 Games module loaded");
