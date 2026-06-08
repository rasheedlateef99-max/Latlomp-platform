/* ============================================
   LATLOMP INSTITUTION — STRUCTURE CONFIG
   
   Defines default classes, roles, and subjects
   for each institution type. This is the single
   source of truth for institution structure.
   
   Used by:
   - Onboarding auto-generation
   - inst.structure.routes.js
   - Frontend type selector
============================================ */

const INSTITUTION_STRUCTURES = {

  primary: {
    label: 'Primary School',
    icon:  '📚',
    classes: [
      { name: 'Primary 1', category: 'primary', sortOrder: 1 },
      { name: 'Primary 2', category: 'primary', sortOrder: 2 },
      { name: 'Primary 3', category: 'primary', sortOrder: 3 },
      { name: 'Primary 4', category: 'primary', sortOrder: 4 },
      { name: 'Primary 5', category: 'primary', sortOrder: 5 },
      { name: 'Primary 6', category: 'primary', sortOrder: 6 }
    ],
    roles: [
      'school_admin', 'class_teacher', 'subject_teacher'
    ],
    defaultSubjects: [
      'Mathematics', 'English Language', 'Basic Science',
      'Social Studies', 'Civic Education', 'Physical Education',
      'Creative Arts', 'Computer Studies', 'Religious Studies'
    ],
    hasDepartments: false,
    hasFaculties:   false
  },

  secondary: {
    label: 'Secondary School',
    icon:  '🏫',
    classes: [
      { name: 'JSS1', category: 'jss', sortOrder: 1 },
      { name: 'JSS2', category: 'jss', sortOrder: 2 },
      { name: 'JSS3', category: 'jss', sortOrder: 3 },
      { name: 'SSS1', category: 'sss', sortOrder: 4 },
      { name: 'SSS2', category: 'sss', sortOrder: 5 },
      { name: 'SSS3', category: 'sss', sortOrder: 6 }
    ],
    roles: [
      'school_admin', 'vice_principal', 'class_teacher', 'subject_teacher'
    ],
    defaultSubjects: [
      'Mathematics', 'English Language', 'Physics', 'Chemistry',
      'Biology', 'Further Mathematics', 'Economics', 'Government',
      'Literature in English', 'Geography', 'History',
      'Agricultural Science', 'Computer Studies', 'Civic Education',
      'Physical Education', 'French', 'Arabic', 'Technical Drawing'
    ],
    hasDepartments: false,
    hasFaculties:   false
  },

  combined: {
    label: 'Combined Primary & Secondary',
    icon:  '🏛️',
    classes: [
      { name: 'Primary 1', category: 'primary', sortOrder: 1 },
      { name: 'Primary 2', category: 'primary', sortOrder: 2 },
      { name: 'Primary 3', category: 'primary', sortOrder: 3 },
      { name: 'Primary 4', category: 'primary', sortOrder: 4 },
      { name: 'Primary 5', category: 'primary', sortOrder: 5 },
      { name: 'Primary 6', category: 'primary', sortOrder: 6 },
      { name: 'JSS1',      category: 'jss',     sortOrder: 7 },
      { name: 'JSS2',      category: 'jss',     sortOrder: 8 },
      { name: 'JSS3',      category: 'jss',     sortOrder: 9 },
      { name: 'SSS1',      category: 'sss',     sortOrder: 10 },
      { name: 'SSS2',      category: 'sss',     sortOrder: 11 },
      { name: 'SSS3',      category: 'sss',     sortOrder: 12 }
    ],
    roles: [
      'school_admin', 'vice_principal', 'class_teacher', 'subject_teacher'
    ],
    defaultSubjects: [
      'Mathematics', 'English Language', 'Basic Science',
      'Physics', 'Chemistry', 'Biology', 'Economics',
      'Government', 'Computer Studies', 'Civic Education'
    ],
    hasDepartments: false,
    hasFaculties:   false
  },

  polytechnic: {
    label: 'Polytechnic',
    icon:  '⚙️',
    classes: [
      { name: 'ND1',  category: 'nd',  sortOrder: 1 },
      { name: 'ND2',  category: 'nd',  sortOrder: 2 },
      { name: 'HND1', category: 'hnd', sortOrder: 3 },
      { name: 'HND2', category: 'hnd', sortOrder: 4 }
    ],
    roles: [
      'school_admin', 'hod', 'lecturer'
    ],
    defaultSubjects: [],
    hasDepartments: true,
    hasFaculties:   false
  },

  university: {
    label: 'University',
    icon:  '🎓',
    classes: [
      { name: '100 Level', category: 'level', sortOrder: 1 },
      { name: '200 Level', category: 'level', sortOrder: 2 },
      { name: '300 Level', category: 'level', sortOrder: 3 },
      { name: '400 Level', category: 'level', sortOrder: 4 },
      { name: '500 Level', category: 'level', sortOrder: 5 },
      { name: '600 Level', category: 'level', sortOrder: 6 }
    ],
    roles: [
      'school_admin', 'dean', 'hod', 'lecturer'
    ],
    defaultSubjects: [],
    hasDepartments: true,
    hasFaculties:   true
  },

  college_of_education: {
    label: 'College of Education',
    icon:  '📖',
    classes: [
      { name: 'Year 1', category: 'year', sortOrder: 1 },
      { name: 'Year 2', category: 'year', sortOrder: 2 },
      { name: 'Year 3', category: 'year', sortOrder: 3 }
    ],
    roles: [
      'school_admin', 'hod', 'lecturer'
    ],
    defaultSubjects: [],
    hasDepartments: true,
    hasFaculties:   false
  },

  madrasah: {
    label: 'Madrasah / Islamic School',
    icon:  '🕌',
    classes: [
      { name: 'Level 1', category: 'other', sortOrder: 1 },
      { name: 'Level 2', category: 'other', sortOrder: 2 },
      { name: 'Level 3', category: 'other', sortOrder: 3 },
      { name: 'Level 4', category: 'other', sortOrder: 4 },
      { name: 'Level 5', category: 'other', sortOrder: 5 },
      { name: 'Level 6', category: 'other', sortOrder: 6 }
    ],
    roles: [
      'school_admin', 'class_teacher', 'subject_teacher'
    ],
    defaultSubjects: [
      'Arabic Language', 'Islamic Studies', 'Quranic Recitation',
      'Fiqh', 'Tafsir', 'Hadith', 'Mathematics', 'English Language'
    ],
    hasDepartments: false,
    hasFaculties:   false
  },

  training_centre: {
    label: 'Training Centre / Academy',
    icon:  '🔧',
    classes: [
      { name: 'Beginners',    category: 'other', sortOrder: 1 },
      { name: 'Intermediate', category: 'other', sortOrder: 2 },
      { name: 'Advanced',     category: 'other', sortOrder: 3 }
    ],
    roles: [
      'school_admin', 'instructor'
    ],
    defaultSubjects: [],
    hasDepartments: false,
    hasFaculties:   false
  },

  vocational: {
    label: 'Vocational School',
    icon:  '🛠️',
    classes: [
      { name: 'Year 1', category: 'year', sortOrder: 1 },
      { name: 'Year 2', category: 'year', sortOrder: 2 },
      { name: 'Year 3', category: 'year', sortOrder: 3 }
    ],
    roles: [
      'school_admin', 'instructor'
    ],
    defaultSubjects: [],
    hasDepartments: false,
    hasFaculties:   false
  },

  other: {
    label: 'Other Institution',
    icon:  '🏫',
    classes: [
      { name: 'Level 1', category: 'other', sortOrder: 1 },
      { name: 'Level 2', category: 'other', sortOrder: 2 },
      { name: 'Level 3', category: 'other', sortOrder: 3 }
    ],
    roles: [
      'school_admin', 'teacher'
    ],
    defaultSubjects: [],
    hasDepartments: false,
    hasFaculties:   false
  }

};

/* Role display labels */
const ROLE_LABELS = {
  school_admin:    'School Administrator',
  vice_principal:  'Vice Principal',
  class_teacher:   'Class Teacher',
  subject_teacher: 'Subject Teacher',
  lecturer:        'Lecturer',
  instructor:      'Instructor',
  hod:             'Head of Department',
  dean:            'Dean'
};

/* Get full structure config for an institution type */
function getStructure(type) {
  return INSTITUTION_STRUCTURES[type] || INSTITUTION_STRUCTURES['other'];
}

/* Get all types as a flat array for dropdowns */
function getTypes() {
  return Object.keys(INSTITUTION_STRUCTURES).map(function(key) {
    return {
      value: key,
      label: INSTITUTION_STRUCTURES[key].label,
      icon:  INSTITUTION_STRUCTURES[key].icon
    };
  });
}

/* Get default class list for auto-generation */
function getDefaultClasses(type) {
  return getStructure(type).classes || [];
}

/* Get allowed roles for a type */
function getRoles(type) {
  return getStructure(type).roles || ['school_admin', 'teacher'];
}

/* Get default subjects for a type */
function getDefaultSubjects(type) {
  return getStructure(type).defaultSubjects || [];
}

/* Check if this type uses departments */
function hasDepartments(type) {
  return !!(getStructure(type).hasDepartments);
}

/* Check if this type uses faculties */
function hasFaculties(type) {
  return !!(getStructure(type).hasFaculties);
}

module.exports = {
  INSTITUTION_STRUCTURES,
  ROLE_LABELS,
  getStructure,
  getTypes,
  getDefaultClasses,
  getRoles,
  getDefaultSubjects,
  hasDepartments,
  hasFaculties
};