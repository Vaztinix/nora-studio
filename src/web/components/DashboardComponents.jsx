import React, { useState } from 'react';

// ==========================================
// 1. STATUS BADGE COMPONENT (Helper)
// ==========================================
export const StatusBadge = ({ type }) => {
  const normalized = (type || 'WARN').toUpperCase();

  const styles = {
    WARN: {
      bg: 'bg-amber-500/10',
      text: 'text-amber-400',
      border: 'border-amber-500/20',
      label: 'Warning',
    },
    MUTE: {
      bg: 'bg-orange-500/10',
      text: 'text-orange-400',
      border: 'border-orange-500/20',
      label: 'Muted',
    },
    KICK: {
      bg: 'bg-rose-500/10',
      text: 'text-rose-400',
      border: 'border-rose-500/20',
      label: 'Kicked',
    },
    BAN: {
      bg: 'bg-red-500/10',
      text: 'text-red-400',
      border: 'border-red-500/20',
      label: 'Banned',
    },
    TEMPBAN: {
      bg: 'bg-red-500/10',
      text: 'text-red-400',
      border: 'border-red-500/20',
      label: 'Temp Ban',
    },
    UNBAN: {
      bg: 'bg-emerald-500/10',
      text: 'text-emerald-400',
      border: 'border-emerald-500/20',
      label: 'Unbanned',
    },
    UNMUTE: {
      bg: 'bg-emerald-500/10',
      text: 'text-emerald-400',
      border: 'border-emerald-500/20',
      label: 'Unmuted',
    },
    ROLE_ADD: {
      bg: 'bg-indigo-500/10',
      text: 'text-indigo-400',
      border: 'border-indigo-500/20',
      label: 'Role Added',
    },
    ROLE_REMOVE: {
      bg: 'bg-indigo-500/10',
      text: 'text-indigo-400',
      border: 'border-indigo-500/20',
      label: 'Role Removed',
    },
  };

  const current = styles[normalized] || {
    bg: 'bg-slate-500/10',
    text: 'text-slate-400',
    border: 'border-slate-500/20',
    label: normalized,
  };

  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold tracking-wide border ${current.bg} ${current.text} ${current.border}`}>
      {current.label}
    </span>
  );
};

// ==========================================
// 2. CASE CARD COMPONENT (Notes UI Mirror)
// ==========================================
export const CaseCard = ({ caseData, onUpdateReason }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editedReason, setEditedReason] = useState(caseData.reason || '');

  const handleSaveEdit = (e) => {
    e.stopPropagation(); // Avoid folding the card when clicking save
    onUpdateReason(caseData.id, editedReason);
    setIsEditing(false);
  };

  const handleCancelEdit = (e) => {
    e.stopPropagation();
    setEditedReason(caseData.reason || '');
    setIsEditing(false);
  };

  const formatRelativeTime = (timestamp) => {
    const d = new Date(timestamp);
    const diffMs = Date.now() - d.getTime();
    const diffMins = Math.round(diffMs / 60000);
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.round(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  };

  return (
    <div
      className={`group relative overflow-hidden rounded-xl border border-slate-800/60 bg-slate-900/35 backdrop-blur-md transition-all duration-300 hover:border-slate-700/60 hover:bg-slate-900/50 shadow-xl ${isExpanded ? 'ring-1 ring-sky-500/20 bg-slate-900/50' : ''
        }`}
    >
      {/* Header section (Always visible) */}
      <div
        className="flex items-center justify-between p-5 cursor-pointer select-none"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center space-x-4">
          <div className="flex flex-col">
            <span className="text-sm font-bold text-slate-200">
              Case #{caseData.id}
            </span>
            <span className="text-xs text-slate-500">
              {formatRelativeTime(caseData.timestamp)}
            </span>
          </div>
          <StatusBadge type={caseData.type} />
        </div>

        <div className="flex items-center space-x-3">
          {/* Quick Actions (Visually secondary to prevent clutter) */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setIsExpanded(true);
              setIsEditing(true);
            }}
            className="px-3 py-1.5 text-xs font-semibold text-slate-400 hover:text-sky-400 bg-slate-800/40 hover:bg-sky-500/10 border border-slate-700/40 hover:border-sky-500/20 rounded-lg transition-all duration-200"
          >
            Edit Reason
          </button>

          {/* Expand/Collapse Chevron */}
          <svg
            className={`w-5 h-5 text-slate-500 transition-transform duration-300 ${isExpanded ? 'rotate-180 text-slate-300' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </div>

      {/* Expanded Content Area */}
      <div
        className={`transition-all duration-300 ease-in-out overflow-hidden border-slate-800/50 ${isExpanded ? 'max-h-[500px] border-t px-5 pb-5 pt-4' : 'max-h-0'
          }`}
      >
        {isEditing ? (
          <div className="space-y-3" onClick={(e) => e.stopPropagation()}>
            <textarea
              value={editedReason}
              onChange={(e) => setEditedReason(e.target.value)}
              className="w-full min-h-[80px] bg-slate-950/60 border border-slate-800 focus:border-sky-500 focus:ring-1 focus:ring-sky-500/25 rounded-lg p-3 text-sm text-slate-200 placeholder-slate-600 focus:outline-none transition-all duration-200"
              placeholder="Provide a detailed moderation reason..."
            />
            <div className="flex justify-end space-x-2">
              <button
                type="button"
                onClick={handleCancelEdit}
                className="px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200 bg-slate-800/30 hover:bg-slate-800/70 rounded-lg transition-all"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveEdit}
                className="px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-sky-300 bg-sky-400 rounded-lg transition-all shadow-md shadow-sky-400/10"
              >
                Save Reason
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block mb-1">
                Reason
              </span>
              <p className="text-sm text-slate-300 leading-relaxed bg-slate-950/30 border border-slate-950/50 rounded-lg p-3">
                {caseData.reason || 'No reason specified.'}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4 text-xs">
              <div>
                <span className="font-semibold text-slate-500 block mb-0.5">Moderator</span>
                <span className="text-slate-300 font-medium">{caseData.moderatorTag || caseData.moderatorId}</span>
              </div>
              <div>
                <span className="font-semibold text-slate-500 block mb-0.5">Target User</span>
                <span className="text-slate-300 font-medium">{caseData.userTag || caseData.userId}</span>
              </div>
              {caseData.duration && (
                <div>
                  <span className="font-semibold text-slate-500 block mb-0.5">Duration</span>
                  <span className="text-slate-300 font-medium">
                    {Math.round(caseData.duration / 60000)} minute(s)
                  </span>
                </div>
              )}
              {caseData.status && (
                <div>
                  <span className="font-semibold text-slate-500 block mb-0.5">Case Status</span>
                  <span className="text-slate-300 capitalize font-medium">{caseData.status}</span>
                </div>
              )}
            </div>

            {/* Evidence Link Section */}
            {caseData.evidenceUrls && caseData.evidenceUrls.length > 0 && (
              <div className="border-t border-slate-800/40 pt-3">
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block mb-1.5">
                  Evidence
                </span>
                <div className="flex flex-wrap gap-2">
                  {caseData.evidenceUrls.map((url, index) => (
                    <a
                      key={index}
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded bg-slate-800/40 border border-slate-700/30 text-xs text-sky-400 hover:text-sky-300 hover:bg-slate-800/80 transition-all"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                      <span>Attachment {index + 1}</span>
                    </a>
                  ))}
                </div>
              </div>
            )}

            {/* Edit Audit Trail */}
            {caseData.editedAt && (
              <div className="text-[10px] text-slate-600 border-t border-slate-800/30 pt-2 flex items-center justify-between">
                <span>Last updated {new Date(caseData.editedAt).toLocaleString()}</span>
                {caseData.editedBy && <span>by {caseData.editedBy}</span>}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

// ==========================================
// 3. CASE HISTORY LIST (Container)
// ==========================================
export const UserCaseHistory = ({ cases, onUpdateCaseReason }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState('ALL');

  const filteredCases = cases.filter(c => {
    const matchesSearch =
      (c.reason || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.id.toString().includes(searchTerm) ||
      (c.userId || '').includes(searchTerm);

    const matchesType = typeFilter === 'ALL' || c.type === typeFilter;

    return matchesSearch && matchesType;
  });

  return (
    <div className="space-y-6">
      {/* Filtering Header Toolbar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-900/20 border border-slate-800/40 rounded-xl p-4">
        <div className="relative flex-1">
          <input
            type="text"
            placeholder="Search cases by reason, ID, or user..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-slate-950/60 border border-slate-800 focus:border-sky-500/60 rounded-lg pl-10 pr-4 py-2 text-sm text-slate-200 focus:outline-none transition-all placeholder-slate-600"
          />
          <svg className="absolute left-3.5 top-2.5 w-4 h-4 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>

        <div className="flex items-center space-x-2">
          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Type:</label>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="bg-slate-950 border border-slate-800 focus:border-sky-500/60 rounded-lg px-3 py-1.5 text-xs text-slate-300 focus:outline-none cursor-pointer"
          >
            <option value="ALL">All Types</option>
            <option value="WARN">Warnings</option>
            <option value="MUTE">Mutes</option>
            <option value="KICK">Kicks</option>
            <option value="BAN">Bans</option>
            <option value="ROLE_ADD">Roles Added</option>
            <option value="ROLE_REMOVE">Roles Removed</option>
          </select>
        </div>
      </div>

      {/* Case Grid/List */}
      {filteredCases.length > 0 ? (
        <div className="space-y-3">
          {filteredCases.map(c => (
            <CaseCard key={c.id} caseData={c} onUpdateReason={onUpdateCaseReason} />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center p-12 rounded-xl border border-slate-900 bg-slate-950/20 text-center">
          <svg className="w-12 h-12 text-slate-700 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <span className="text-sm text-slate-400 font-semibold">No cases found</span>
          <span className="text-xs text-slate-600 mt-1">Try adjusting your filters or search terms.</span>
        </div>
      )}
    </div>
  );
};

// ==========================================
// 4. STICKY BOTTOM SAVE TRAY COMPONENT
// ==========================================
export const SaveTray = ({ isDirty, onSave, onDiscard, isSaving }) => {
  return (
    <div
      className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-50 w-full max-w-2xl px-4 transition-all duration-300 ease-out transform ${isDirty ? 'translate-y-0 opacity-100' : 'translate-y-12 opacity-0 pointer-events-none'
        }`}
    >
      <div className="flex items-center justify-between bg-slate-950/85 backdrop-blur-lg border border-slate-800/80 rounded-full px-6 py-3.5 shadow-2xl shadow-slate-950/60">
        <div className="flex items-center space-x-2">
          <span className="flex h-2 w-2 relative">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-sky-500"></span>
          </span>
          <span className="text-xs md:text-sm font-semibold text-slate-300">
            You have unsaved changes
          </span>
        </div>

        <div className="flex items-center space-x-3">
          <button
            type="button"
            disabled={isSaving}
            onClick={onDiscard}
            className="px-4 py-2 text-xs md:text-sm font-semibold text-slate-400 hover:text-slate-200 hover:bg-slate-900/50 rounded-full transition-all"
          >
            Discard
          </button>

          <button
            type="button"
            disabled={isSaving}
            onClick={onSave}
            className="inline-flex items-center space-x-2 px-5 py-2 text-xs md:text-sm font-bold text-slate-950 bg-sky-400 hover:bg-sky-300 rounded-full transition-all shadow-lg shadow-sky-400/10 focus:ring-2 focus:ring-sky-400/40 disabled:opacity-50"
          >
            {isSaving ? (
              <>
                <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-slate-950" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                <span>Saving...</span>
              </>
            ) : (
              <span>Save Changes</span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

// ==========================================
// 5. PERSISTENT SIDEBAR LAYOUT WRAPPER
// ==========================================
export const DashboardLayout = ({ children, activeTab, onTabChange, guildInfo, userProfile }) => {
  // Navigation sidebar items
  const menuItems = [
    { id: 'overview', icon: 'fa-home', label: 'Overview' },
    { id: 'settings', icon: 'fa-cog', label: 'Settings' },
    { id: 'moderation', icon: 'fa-shield-alt', label: 'Moderation' },
    { id: 'verification', icon: 'fa-user-check', label: 'Verification' },
    { id: 'leveling', icon: 'fa-trophy', label: 'Leveling' },
    { id: 'autoresponder', icon: 'fa-reply', label: 'Autoresponder' },
  ];

  return (
    <div className="min-h-screen flex bg-slate-950 text-slate-100 selection:bg-sky-500/20 selection:text-sky-300">
      {/* 
        PERSISTENT SIDEBAR
        Uses a strict w-64 footprint, flex-shrink-0 to prevent compression, 
        and sticky viewport placement.
      */}
      <aside className="w-64 h-screen sticky top-0 flex-shrink-0 flex flex-col justify-between border-r border-slate-900/60 bg-slate-950/70 backdrop-blur-xl z-30 select-none">
        <div>
          {/* Top Guild Profile Banner */}
          <div className="p-6 border-b border-slate-900/50 flex items-center space-x-3.5">
            {guildInfo?.icon ? (
              <img
                src={guildInfo.icon}
                alt={guildInfo.name}
                className="w-10 h-10 rounded-xl object-cover ring-2 ring-slate-800/80 flex-shrink-0"
              />
            ) : (
              <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-sky-600 to-indigo-700 flex items-center justify-center font-bold text-slate-200 flex-shrink-0">
                {guildInfo?.name ? guildInfo.name.substring(0, 2) : 'NS'}
              </div>
            )}
            {/* flex-1 min-w-0 prevents text overflow ellipsis from distorting parent containers */}
            <div className="flex-1 min-w-0">
              <h1 className="text-sm font-bold text-slate-200 truncate leading-snug">
                {guildInfo?.name || 'Nora Studio'}
              </h1>
              <span className="text-[10px] font-semibold tracking-wider text-slate-500 uppercase block mt-0.5">
                Guild Console
              </span>
            </div>
          </div>

          {/* Navigation Links */}
          <nav className="p-4 space-y-1.5">
            {menuItems.map(item => {
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onTabChange(item.id)}
                  className={`w-full flex items-center space-x-3.5 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-200 focus:outline-none ${isActive
                      ? 'bg-sky-500/10 text-sky-400 border border-sky-500/10 shadow-[inset_0_0_12px_rgba(14,165,233,0.06)]'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/40 border border-transparent'
                    }`}
                >
                  <i className={`fas ${item.icon} w-5 text-center flex-shrink-0 ${isActive ? 'text-sky-400' : 'text-slate-500'}`} />
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Bottom User Profile Section */}
        <div className="p-5 border-t border-slate-900/50 bg-slate-900/10">
          <div className="flex items-center space-x-3.5">
            {/* Avatar block with badge layer */}
            <div className="relative flex-shrink-0">
              {userProfile?.avatar ? (
                <img
                  src={userProfile.avatar}
                  alt={userProfile.username}
                  className="w-10 h-10 rounded-full ring-2 ring-slate-800/80"
                />
              ) : (
                <div className="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center text-sm font-semibold text-slate-400">
                  U
                </div>
              )}
              {/* Active session badge indicator */}
              <span className="absolute bottom-0 right-0 block h-3 w-3 rounded-full bg-emerald-500 ring-2 ring-slate-950" />
            </div>

            {/* User Details */}
            <div className="flex-1 min-w-0">
              <span className="text-xs font-bold text-slate-300 block truncate">
                {userProfile?.username || 'Administrator'}
              </span>
              <span className="text-[10px] text-slate-500 block truncate font-medium mt-0.5">
                Session Active
              </span>
            </div>
          </div>
        </div>
      </aside>

      {/* 
        MAIN CONTENT CONTAINER
        Occupies the remainder of screen width, scrolling independently.
      */}
      <main className="flex-1 min-w-0 overflow-y-auto bg-slate-950/20">
        <div className="max-w-6xl mx-auto px-8 py-10">
          {children}
        </div>
      </main>
    </div>
  );
};
