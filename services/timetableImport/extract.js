// Reads every class timetable in a PDF and returns clean, matched previews.
const { readPdfAsJson } = require('./gemini');
const { normalizePeriods, normalizeCells, matchClass, matchTeacher } = require('./normalize');

const PROMPT = `This PDF contains one or more school class timetables (weekly bell schedules).
For EVERY class timetable in the document return one entry in "classes":
- "label": the class name exactly as written (e.g. "Class VII - A", "Grade 7 A", "8B").
- "homeroomTeacher": the class teacher if stated, else "".
- "periods": every row/column of the bell schedule in order, including breaks and lunch: "label" as written (e.g. "1", "P2", "Short Break", "Lunch"), "start" and "end" times exactly as written, "isBreak" true for breaks/lunch/recess/assembly.
- "cells": one entry per filled teaching cell: "day" (as written), "period" (the period's label exactly as in "periods"), "subject" (full subject name; expand abbreviations using any legend or key in the document), "teacher" (teacher name if shown, without the subject, else ""), "room" (if shown, else "").
Do not invent anything that is not in the PDF. Skip empty cells and break cells.`;

const STR = { type: 'STRING' };
const SCHEMA = {
  type: 'OBJECT',
  properties: {
    classes: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          label: STR,
          homeroomTeacher: STR,
          periods: { type: 'ARRAY', items: { type: 'OBJECT', properties: { label: STR, start: STR, end: STR, isBreak: { type: 'BOOLEAN' } }, required: ['label', 'start', 'end', 'isBreak'] } },
          cells: { type: 'ARRAY', items: { type: 'OBJECT', properties: { day: STR, period: STR, subject: STR, teacher: STR, room: STR }, required: ['day', 'period', 'subject'] } },
        },
        required: ['label', 'periods', 'cells'],
      },
    },
  },
  required: ['classes'],
};

// Pure: model output + school data -> previews. canSave(match) decides per class.
function buildPreview(raw, { grades, teachers, canSave }) {
  return (raw?.classes || []).map((c) => {
    const { periodDefs, codeByLabel } = normalizePeriods(c.periods);
    const { slots, warnings } = normalizeCells(c.cells, codeByLabel, periodDefs);
    const { match, reason } = matchClass(c.label, grades);
    const unknownTeachers = new Set();
    const withTeachers = slots.map((s) => {
      const teacherId = s.teacherName ? matchTeacher(s.teacherName, teachers) : null;
      if (s.teacherName && !teacherId) unknownTeachers.add(s.teacherName);
      return { ...s, teacherId };
    });
    if (unknownTeachers.size) warnings.push(`Teachers not found in this school (subject saved without a teacher): ${[...unknownTeachers].join(', ')}`);
    if (!periodDefs.length) warnings.push('No periods found');
    return {
      label: String(c.label || '').trim(),
      homeroomTeacher: String(c.homeroomTeacher || '').trim(),
      match,
      matchReason: reason || null,
      canSave: !!match && canSave(match),
      periodDefs,
      slots: withTeachers,
      warnings,
    };
  });
}

async function extractTimetables(pdfBuffer, ctx) {
  const raw = await readPdfAsJson(pdfBuffer, PROMPT, SCHEMA);
  return buildPreview(raw, ctx);
}

module.exports = { extractTimetables, buildPreview, PROMPT, SCHEMA };
