const TEMPLATES = [
  {
    id: 'standup',
    label: 'Daily Standup',
    description: 'What you did yesterday, today\'s plan, and blockers',
    template: {
      title: 'Daily Standup',
      meetingType: 'standup',
      shortSummary: '',
      fullSummary: '',
      actionItems: [
        'What I did yesterday',
        'What I\'ll do today',
        'Blockers',
      ],
    },
  },
  {
    id: 'client-call',
    label: 'Client Call',
    description: 'Key decisions, next steps, and open questions',
    template: {
      title: 'Client Call',
      meetingType: 'client',
      shortSummary: '',
      fullSummary: '',
      actionItems: [
        'Key decisions',
        'Next steps',
        'Open questions',
      ],
    },
  },
  {
    id: 'interview',
    label: 'Interview',
    description: 'Structured Q&A and candidate evaluation',
    template: {
      title: 'Interview Notes',
      meetingType: 'interview',
      shortSummary: '',
      fullSummary: '',
      actionItems: [
        'Questions asked',
        'Candidate responses',
        'Evaluation notes',
      ],
    },
  },
  {
    id: 'brainstorming',
    label: 'Brainstorming',
    description: 'Capture ideas, themes, and action items',
    template: {
      title: 'Brainstorming Session',
      meetingType: 'meeting',
      shortSummary: '',
      fullSummary: '',
      actionItems: [
        'Ideas generated',
        'Key themes',
        'Follow-up items',
      ],
    },
  },
];

export default function NoteTemplates({ onSelect, onClose }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="template-modal" onClick={(e) => e.stopPropagation()}>
        <div className="template-header">
          <h2>New Note from Template</h2>
          <button className="template-close" onClick={onClose}>&times;</button>
        </div>
        <div className="template-grid">
          {TEMPLATES.map((t) => (
            <div
              key={t.id}
              className="template-card"
              onClick={() => { onSelect(t.template); onClose(); }}
            >
              <h3 className="template-card-title">{t.label}</h3>
              <p className="template-card-desc">{t.description}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
