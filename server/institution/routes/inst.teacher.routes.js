/* ============================================
   LATLOMP INSTITUTION — TEACHER ROUTES

   ✅ CBT UPGRADE: examYear, scheduledStart/End
   ✅ PHASE G:     tableHtml + audioUrl on questions
============================================ */
const express        = require('express');
const router         = express.Router();
const SchoolExam     = require('../models/SchoolExam.model');
const SchoolQuestion = require('../models/SchoolQuestion.model');
const SchoolResult   = require('../models/SchoolResult.model');
const { instProtect, teacherOrAdmin } = require('../middleware/inst.auth');
const { requireActiveSubscription }   = require('../middleware/inst.tenant');

var guard = [instProtect, teacherOrAdmin, requireActiveSubscription];

function shuffle(arr) {
  var a = arr.slice();
  for (var i = a.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

/* ---- Create exam ---- */
router.post('/exams', guard, async (req, res) => {
  try {
    var exam = await SchoolExam.create({
      schoolId:         req.schoolId,
      createdBy:        req.schoolUser._id,
      title:            req.body.title,
      subject:          req.body.subject,
      class:            req.body.class            || '',
      term:             req.body.term             || '',
      session:          req.body.session          || '',
      examYear:         parseInt(req.body.examYear) || new Date().getFullYear(),
      examType:         req.body.examType         || 'objective',
      instructions:     req.body.instructions     || '',
      duration:         parseInt(req.body.duration)   || 60,
      totalMarks:       parseInt(req.body.totalMarks) || 100,
      passMark:         parseInt(req.body.passMark)   || 50,
      shuffleQuestions: req.body.shuffleQuestions !== false,
      shuffleOptions:   !!req.body.shuffleOptions,
      showResultsAfter: req.body.showResultsAfter || false,
      scheduledStart:   req.body.scheduledStart   || null,
      scheduledEnd:     req.body.scheduledEnd     || null,
      status: 'draft'
    });
    return res.status(201).json({ success: true, message: 'Exam created.', exam });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ---- Get teacher's exams ---- */
router.get('/exams', guard, async (req, res) => {
  try {
    var filter = { schoolId: req.schoolId };
    if (req.schoolUser.role === 'teacher') filter.createdBy = req.schoolUser._id;
    var exams = await SchoolExam.find(filter).sort({ createdAt: -1 });
    return res.status(200).json({ success: true, exams });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ---- Get single exam with questions ---- */
router.get('/exams/:id', guard, async (req, res) => {
  try {
    var exam = await SchoolExam.findOne({ _id: req.params.id, schoolId: req.schoolId });
    if (!exam) return res.status(404).json({ success: false, message: 'Exam not found.' });
    var questions = await SchoolQuestion.find({ examId: exam._id, isActive: true }).sort({ sortOrder: 1 });
    return res.status(200).json({ success: true, exam, questions, questionCount: questions.length });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ---- Update exam ---- */
router.put('/exams/:id', guard, async (req, res) => {
  try {
    var exam = await SchoolExam.findOne({ _id: req.params.id, schoolId: req.schoolId });
    if (!exam) return res.status(404).json({ success: false, message: 'Exam not found.' });
    if (exam.status === 'active') {
      return res.status(400).json({ success: false, message: 'Cannot edit an active exam.' });
    }
    var fields = [
      'title','subject','class','term','session','examYear',
      'instructions','duration','totalMarks','passMark',
      'shuffleQuestions','shuffleOptions','showResultsAfter',
      'scheduledStart','scheduledEnd'
    ];
    fields.forEach(function(f) { if (req.body[f] !== undefined) exam[f] = req.body[f]; });
    await exam.save();
    return res.status(200).json({ success: true, message: 'Exam updated.', exam });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ---- Publish exam ---- */
router.post('/exams/:id/publish', guard, async (req, res) => {
  try {
    var exam = await SchoolExam.findOne({ _id: req.params.id, schoolId: req.schoolId });
    if (!exam) return res.status(404).json({ success: false, message: 'Exam not found.' });
    var qCount = await SchoolQuestion.countDocuments({ examId: exam._id, isActive: true });
    if (qCount === 0) return res.status(400).json({ success: false, message: 'Cannot publish exam with no questions.' });
    exam.status         = 'published';
    exam.totalQuestions = qCount;
    await exam.save();
    return res.status(200).json({ success: true, message: 'Exam published! Share code: ' + exam.accessCode, accessCode: exam.accessCode, exam });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ---- End exam ---- */
router.post('/exams/:id/end', guard, async (req, res) => {
  try {
    var exam = await SchoolExam.findOneAndUpdate(
      { _id: req.params.id, schoolId: req.schoolId },
      { $set: { status: 'ended' } },
      { new: true }
    );
    return res.status(200).json({ success: true, message: 'Exam ended.', exam });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ---- Add question ---- */
router.post('/exams/:id/questions', guard, async (req, res) => {
  try {
    var exam = await SchoolExam.findOne({ _id: req.params.id, schoolId: req.schoolId });
    if (!exam) return res.status(404).json({ success: false, message: 'Exam not found.' });

    var {
      questionType, question, options, correctAnswer,
      explanation, modelAnswer, markScheme,
      marks, difficulty, topic,
      imageUrl, tableHtml, audioUrl   /* ✅ PHASE G */
    } = req.body;

    /* Sanitise tableHtml — only allow table/thead/tbody/tr/th/td/colgroup/col */
    var safeTableHtml = '';
    if (tableHtml && typeof tableHtml === 'string') {
      safeTableHtml = tableHtml
        .replace(/<script[^>]*>.*?<\/script>/gi, '')
        .replace(/on\w+="[^"]*"/gi, '')
        .replace(/javascript:/gi, '');
    }

    var q = await SchoolQuestion.create({
      schoolId:      req.schoolId,
      examId:        exam._id,
      questionType:  questionType || 'objective',
      question,
      options:       options       || [],
      correctAnswer: parseInt(correctAnswer) || 0,
      explanation:   explanation   || '',
      modelAnswer:   modelAnswer   || '',
      markScheme:    markScheme    || '',
      marks:         parseInt(marks) || 1,
      difficulty:    difficulty    || 'medium',
      topic:         topic         || '',
      imageUrl:      imageUrl      || '',
      tableHtml:     safeTableHtml,       /* ✅ PHASE G */
      audioUrl:      audioUrl      || ''  /* ✅ PHASE G */
    });

    var qCount = await SchoolQuestion.countDocuments({ examId: exam._id, isActive: true });
    await SchoolExam.findByIdAndUpdate(exam._id, { totalQuestions: qCount });
    return res.status(201).json({ success: true, message: 'Question added.', question: q });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ---- Update question ---- */
router.put('/questions/:id', guard, async (req, res) => {
  try {
    var allowed = [
      'questionType','question','options','correctAnswer','explanation',
      'modelAnswer','markScheme','marks','difficulty','topic','sortOrder',
      'imageUrl','tableHtml','audioUrl'  /* ✅ PHASE G */
    ];
    var updates = {};
    allowed.forEach(function(f) { if (req.body[f] !== undefined) updates[f] = req.body[f]; });

    /* Sanitise tableHtml if updating */
    if (updates.tableHtml) {
      updates.tableHtml = updates.tableHtml
        .replace(/<script[^>]*>.*?<\/script>/gi, '')
        .replace(/on\w+="[^"]*"/gi, '')
        .replace(/javascript:/gi, '');
    }

    var q = await SchoolQuestion.findOneAndUpdate(
      { _id: req.params.id, schoolId: req.schoolId },
      { $set: updates },
      { new: true }
    );
    if (!q) return res.status(404).json({ success: false, message: 'Question not found.' });
    return res.status(200).json({ success: true, message: 'Question updated.', question: q });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ---- Delete question ---- */
router.delete('/questions/:id', guard, async (req, res) => {
  try {
    var q = await SchoolQuestion.findOneAndDelete({ _id: req.params.id, schoolId: req.schoolId });
    if (q) {
      var qCount = await SchoolQuestion.countDocuments({ examId: q.examId, isActive: true });
      await SchoolExam.findByIdAndUpdate(q.examId, { totalQuestions: qCount });
    }
    return res.status(200).json({ success: true, message: 'Question deleted.' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ---- Get exam results (teacher view) ---- */
router.get('/exams/:id/results', guard, async (req, res) => {
  try {
    var exam = await SchoolExam.findOne({ _id: req.params.id, schoolId: req.schoolId });
    if (!exam) return res.status(404).json({ success: false, message: 'Exam not found.' });
    var results  = await SchoolResult.find({ examId: exam._id }).select('-answers').sort({ scorePercent: -1 });
    var total    = results.length;
    var passed   = results.filter(function(r) { return r.isPassed; }).length;
    var avgScore = total > 0 ? Math.round(results.reduce(function(s,r){return s+r.scorePercent;},0)/total) : 0;
    return res.status(200).json({
      success: true, exam, results,
      summary: { total, passed, failed: total-passed, passRate: total>0?Math.round((passed/total)*100):0, averageScore:avgScore, highestScore:results[0]?results[0].scorePercent:0 }
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ---- Grade theory questions ---- */
router.post('/results/:id/grade', guard, async (req, res) => {
  try {
    var result = await SchoolResult.findOne({ _id: req.params.id, schoolId: req.schoolId });
    if (!result) return res.status(404).json({ success: false, message: 'Result not found.' });
    var { grades } = req.body;
    if (!Array.isArray(grades)) return res.status(400).json({ success: false, message: 'Grades array is required.' });
    var theoryScore = 0;
    grades.forEach(function(g) {
      var answer = result.answers.find(function(a) { return a.questionId && a.questionId.toString() === g.questionId; });
      if (answer) {
        answer.marksAwarded   = Math.max(0, parseInt(g.marksAwarded)||0);
        answer.teacherComment = g.teacherComment || '';
        theoryScore          += answer.marksAwarded;
      }
    });
    result.theoryScore  = theoryScore;
    result.theoryMarked = true;
    result.markedBy     = req.schoolUser._id;
    result.markedAt     = new Date();
    var totalScore      = result.objectiveScore + theoryScore;
    result.score        = totalScore;
    result.scorePercent = result.totalMarks>0 ? Math.round((totalScore/result.totalMarks)*100) : 0;
    result.isPassed     = result.scorePercent >= result.passMark;
    await result.save();
    return res.status(200).json({ success: true, message: 'Theory marked.', result });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ---- Analytics ---- */
router.get('/analytics', guard, async (req, res) => {
  try {
    var schoolId   = req.schoolId;
    var examFilter = { schoolId };
    if (req.schoolUser.role === 'teacher') examFilter.createdBy = req.schoolUser._id;
    var exams = await SchoolExam.find(examFilter).select('_id title subject class status totalAttempts createdAt').lean();
    var examIds    = exams.map(function(e){return e._id;});
    var allResults = examIds.length>0 ? await SchoolResult.find({examId:{$in:examIds},schoolId}).select('examId scorePercent isPassed theoryMarked studentName createdAt').lean() : [];
    var total=allResults.length, passed=allResults.filter(function(r){return r.isPassed;}).length;
    var scores=allResults.map(function(r){return r.scorePercent||0;});
    var avgScore=scores.length>0?Math.round(scores.reduce(function(a,b){return a+b;},0)/scores.length):0;
    var examStats=exams.map(function(exam){
      var eRes=allResults.filter(function(r){return r.examId&&r.examId.toString()===exam._id.toString();});
      var ePassed=eRes.filter(function(r){return r.isPassed;}).length;
      var eScores=eRes.map(function(r){return r.scorePercent||0;});
      var eAvg=eScores.length>0?Math.round(eScores.reduce(function(a,b){return a+b;},0)/eScores.length):0;
      return {_id:exam._id,title:exam.title,subject:exam.subject,class:exam.class,status:exam.status,attempts:eRes.length,passed:ePassed,passRate:eRes.length>0?Math.round((ePassed/eRes.length)*100):0,avgScore:eAvg};
    });
    var thirtyDaysAgo=new Date(Date.now()-30*86400000), timelineMap={};
    allResults.filter(function(r){return new Date(r.createdAt)>=thirtyDaysAgo;}).forEach(function(r){
      var day=new Date(r.createdAt).toISOString().split('T')[0];
      if(!timelineMap[day])timelineMap[day]={date:day,submissions:0,passed:0};
      timelineMap[day].submissions++;
      if(r.isPassed)timelineMap[day].passed++;
    });
    return res.status(200).json({success:true,overview:{totalExams:exams.length,totalSubmissions:total,avgScore,passed,failed:total-passed,passRate:total>0?Math.round((passed/total)*100):0,needsGrading:allResults.filter(function(r){return !r.theoryMarked;}).length},examStats,timeline:Object.values(timelineMap).sort(function(a,b){return a.date.localeCompare(b.date);})});
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;