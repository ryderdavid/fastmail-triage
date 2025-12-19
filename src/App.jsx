import React, { useState, useEffect } from 'react';
import { Mail, Clock, Calendar, AlertCircle, CheckCircle2, Loader2, ExternalLink, ChevronDown, MessageCircle, X, Send, Settings, Eye, EyeOff, RefreshCw } from 'lucide-react';

const FastmailTriage = () => {
  const [activeTab, setActiveTab] = useState('today');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [emails, setEmails] = useState({ today: [], yesterday: [], week: [] });
  
  // Load from environment variables with fallback to 'test' for testing
  const [fastmailApiKey] = useState(() => {
    if (typeof process !== 'undefined' && process.env?.FASTMAIL_API_KEY) {
      return process.env.FASTMAIL_API_KEY;
    }
    return 'test'; // For testing in browser
  });
  const [anthropicApiKey] = useState(() => {
    if (typeof process !== 'undefined' && process.env?.ANTHROPIC_API_KEY) {
      return process.env.ANTHROPIC_API_KEY;
    }
    return 'test'; // For testing in browser
  });
  const [openaiApiKey] = useState(() => {
    if (typeof process !== 'undefined' && process.env?.OPENAI_API_KEY) {
      return process.env.OPENAI_API_KEY;
    }
    return 'test'; // For testing in browser
  });
  
  const [selectedModel, setSelectedModel] = useState('gpt-4o-mini');
  const [showSettings, setShowSettings] = useState(true);
  const [settingsExpanded, setSettingsExpanded] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [lastFetchDates, setLastFetchDates] = useState({ yesterday: null, week: null });
  const [configSaved, setConfigSaved] = useState(false);
  const [showFastmailKey, setShowFastmailKey] = useState(false);
  const [showAnthropicKey, setShowAnthropicKey] = useState(false);
  const [showOpenaiKey, setShowOpenaiKey] = useState(false);
  const [loadingToday, setLoadingToday] = useState(false);
  const [todayPressed, setTodayPressed] = useState(false);

  const saveConfig = () => {
    setConfigSaved(true);
    setSettingsExpanded(false);
  };

  // Folders to exclude from email triage (Marketing, BlackHole, Spam, Junk, Trash)
  const EXCLUDED_FOLDER_NAMES = ['marketing', 'blackhole', 'spam', 'junk', 'trash'];
  
  // Fetch mailbox IDs for excluded folders
  const getExcludedMailboxIds = async () => {
    const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';
    
    const response = await fetch(`${API_BASE_URL}/api/fastmail`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        using: ['urn:ietf:params:jmap:core', 'urn:ietf:params:jmap:mail'],
        methodCalls: [
          ['Mailbox/get', {
            properties: ['id', 'name', 'role']
          }, 'mailboxes']
        ]
      })
    });

    if (!response.ok) {
      throw new Error('Failed to load mailboxes');
    }

    const data = await response.json();
    const mailboxes = data?.methodResponses?.find(([name]) => name === 'Mailbox/get')?.[1]?.list || [];
    
    // Find mailboxes to exclude by name (case-insensitive) or by role
    const excludedIds = mailboxes
      .filter(mb => {
        const name = (mb.name || '').toLowerCase();
        const role = (mb.role || '').toLowerCase();
        return EXCLUDED_FOLDER_NAMES.includes(name) || ['spam', 'junk', 'trash'].includes(role);
      })
      .map(mb => mb.id);
    
    return [...new Set(excludedIds)];
  };

  const fetchEmails = async (startDate, endDate) => {
    const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

    // First, get the mailbox IDs to exclude
    const excludedMailboxIds = await getExcludedMailboxIds();

    // Build the filter with date range and mailbox exclusions
    const filter = {
      after: startDate.toISOString(),
      before: endDate.toISOString()
    };
    
    // Add mailbox exclusion filter if we have IDs to exclude
    if (excludedMailboxIds.length > 0) {
      filter.inMailboxOtherThan = excludedMailboxIds;
    }

    const response = await fetch(`${API_BASE_URL}/api/fastmail`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        using: ['urn:ietf:params:jmap:core', 'urn:ietf:params:jmap:mail'],
        methodCalls: [
          ['Email/query', {
            filter,
            sort: [{ property: 'receivedAt', isAscending: false }],
            limit: 50
          }, 'a'],
          ['Email/get', {
            '#ids': { resultOf: 'a', name: 'Email/query', path: '/ids' },
            properties: ['id', 'subject', 'from', 'receivedAt', 'preview', 'textBody', 'mailboxIds']
          }, 'b']
        ]
      })
    });

    if (!response.ok) {
      throw new Error('Failed to load emails');
    }

    const data = await response.json();
    const emailGetResponse = data?.methodResponses?.find(([name]) => name === 'Email/get');
    return emailGetResponse?.[1]?.list || [];
  };

  const classifyEmails = async (emailList) => {
    const emailTexts = emailList.map((email, idx) =>
      `Email ${idx}:\nFrom: ${email.from?.[0]?.email || 'Unknown'}\nSubject: ${email.subject}\nPreview: ${email.preview}`
    ).join('\n\n');

    const prompt = `You are an email triage assistant focused on ACTIONABILITY. Your job is to surface emails that require the user to DO something, not just emails that sound important.

Classify each email as:
- ACTIONABLE: User must take a specific action (reply, pay, schedule, sign, submit, confirm, complete a form, make a decision). Missing this email would cause a real problem.
- INFORMATIONAL: Worth a quick glance but no action required (shipping confirmations, purchase receipts with no issues, account statements, successful payment confirmations).
- SKIP: Do not surface. This includes marketing, promotional offers, political campaigns, fundraising requests, newsletters, social media notifications, automated alerts, and anything where the user is not personally required to do something.

IMPORTANT RULES:
- Just because an email contains words like "review", "important", or "action" does NOT make it actionable
- Receipts and order confirmations are INFORMATIONAL unless there is a problem requiring action
- Shipping/delivery notifications are INFORMATIONAL (no action needed to receive a package)
- Political emails and fundraising are ALWAYS SKIP regardless of urgency language
- Marketing emails are ALWAYS SKIP even if they mention "limited time" or "expiring"
- If unsure, ask: "Would missing this email cause the user to miss a deadline, lose money, or fail to fulfill an obligation?"

For each ACTIONABLE or INFORMATIONAL email, provide:
1. Category (ACTIONABLE or INFORMATIONAL)
2. One-line summary (under 100 chars) describing what the email is about
3. Specific action needed (or "No action needed" if just informational)
4. Three lines of contextual information (each under 80 chars) that highlight the most important details

Classify these emails:

${emailTexts}

Respond in JSON format with this exact structure:
{
  "classifications": [
    {
      "email_index": 0,
      "category": "ACTIONABLE",
      "summary": "Medical appointment on Dec 22",
      "action": "Print and fill out questionnaire",
      "context": [
        "Appointment scheduled for 2:00 PM",
        "Bring insurance card and ID",
        "Arrive 15 minutes early for check-in"
      ]
    }
  ]
}

Only include emails that are ACTIONABLE or INFORMATIONAL in your response. Skip all others.`;

    const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';
    let response, data;

    if (selectedModel === 'haiku-4.5') {
      response = await fetch(`${API_BASE_URL}/api/anthropic/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 4000,
          messages: [{
            role: 'user',
            content: prompt
          }]
        })
      });

      data = await response.json();
      const text = data.content[0].text;
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      const classifications = jsonMatch ? JSON.parse(jsonMatch[0]) : { classifications: [] };

      return classifications.classifications.map(c => ({
        ...emailList[c.email_index],
        category: c.category,
        summary: c.summary,
        action: c.action,
        context: c.context || []
      }));
    } else if (selectedModel === 'gpt-4o-mini') {
      response = await fetch(`${API_BASE_URL}/api/openai/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [{
            role: 'user',
            content: prompt
          }],
          response_format: { type: 'json_object' }
        })
      });

      data = await response.json();
      const text = data.choices[0].message.content;
      const classifications = JSON.parse(text);

      return classifications.classifications.map(c => ({
        ...emailList[c.email_index],
        category: c.category,
        summary: c.summary,
        action: c.action,
        context: c.context || []
      }));
    }
  };

  const loadEmails = async () => {
    if (selectedModel === 'haiku-4.5' && !anthropicApiKey) {
      setError('Anthropic API key not configured');
      return;
    }

    if (selectedModel === 'gpt-4o-mini' && !openaiApiKey) {
      setError('OpenAI API key not configured');
      return;
    }

    setLoading(true);
    setError(null);

    // Mock data for testing
    if (fastmailApiKey === 'test' && anthropicApiKey === 'test') {
      setTimeout(() => {
        const mockEmails = {
          today: normalizeEmails([
            {
              id: 'msg001',
              subject: 'Urgent: Medical Appointment Confirmation',
              from: [{ name: 'Desert Health Clinic', email: 'appointments@deserthealthclinic.com' }],
              receivedAt: new Date().toISOString(),
              preview: 'Your appointment is scheduled for tomorrow at 2pm...',
              category: 'ACTIONABLE',
              summary: 'Medical appointment tomorrow at 2pm',
              action: 'Confirm attendance and bring insurance card',
              context: [
                'Appointment scheduled for December 19, 2025 at 2:00 PM',
                'Dr. Sarah Martinez - Annual physical examination',
                'Bring insurance card, ID, and list of current medications'
              ]
            },
            {
              id: 'msg002',
              subject: 'AWS Bill - Payment Method Update Required',
              from: [{ name: 'AWS Billing', email: 'billing@aws.amazon.com' }],
              receivedAt: new Date().toISOString(),
              preview: 'Your payment method needs to be updated...',
              category: 'ACTIONABLE',
              summary: 'AWS payment method needs updating',
              action: 'Update payment information in console',
              context: [
                'Current payment method expires December 31, 2025',
                'Total outstanding balance: $347.82 for December usage',
                'Update required within 48 hours to avoid service interruption'
              ]
            },
            {
              id: 'msg003',
              subject: 'Receipt: Your Purchase at Home Depot #4523',
              from: [{ name: 'Home Depot', email: 'receipts@homedepot.com' }],
              receivedAt: new Date().toISOString(),
              preview: 'Thank you for your purchase...',
              category: 'INFORMATIONAL',
              summary: 'Home Depot purchase receipt - $127.43',
              action: 'No action needed',
              context: [
                'Purchase total: $127.43 on December 18, 2025',
                'Items: LED shop lights, electrical supplies, hardware',
                'Store #4523, Albuquerque, NM - Transaction #TA2345678'
              ]
            }
          ]),
          yesterday: normalizeEmails([
            {
              id: 'msg004',
              subject: 'Package Delivery Notification',
              from: [{ name: 'FedEx Tracking', email: 'tracking@fedex.com' }],
              receivedAt: new Date(Date.now() - 86400000).toISOString(),
              preview: 'Your package will arrive today between 2-6pm...',
              category: 'INFORMATIONAL',
              summary: 'FedEx delivery arriving between 2-6pm',
              action: 'No action needed',
              context: [
                'Tracking number: 892374658293 - Scheduled for December 17',
                'From: B&H Photo Video - Camera equipment order',
                'Package will be left at door if no signature required'
              ]
            },
            {
              id: 'msg005',
              subject: 'December HOA Meeting Minutes Available',
              from: [{ name: 'Vista Hills HOA', email: 'board@vistahillshoa.org' }],
              receivedAt: new Date(Date.now() - 86400000).toISOString(),
              preview: 'Please review the minutes from last meeting...',
              category: 'INFORMATIONAL',
              summary: 'HOA meeting minutes available for review',
              action: 'No action needed',
              context: [
                'December 15 meeting minutes - New landscaping proposal approved',
                'Annual dues increase of 3% effective January 2026',
                'Community pool resurfacing scheduled for March 2026'
              ]
            }
          ]),
          week: normalizeEmails([
            {
              id: 'msg006',
              subject: 'Tax Documents Ready - Action Required',
              from: [{ name: 'Fidelity Investments', email: 'documents@fidelity.com' }],
              receivedAt: new Date(Date.now() - 259200000).toISOString(),
              preview: 'Your 1099 forms are now available...',
              category: 'ACTIONABLE',
              summary: 'Tax documents ready for download',
              action: 'Download and review 1099 forms before tax filing',
              context: [
                '2024 Form 1099-DIV and 1099-INT now available',
                'Total reportable income: $4,237.89 from dividends',
                'Access through secure document center - download by Feb 15'
              ]
            },
            {
              id: 'msg007',
              subject: 'Security Alert: New Login from Phoenix, AZ',
              from: [{ name: 'GitHub Security', email: 'security@github.com' }],
              receivedAt: new Date(Date.now() - 345600000).toISOString(),
              preview: 'We detected a login from a new location...',
              category: 'ACTIONABLE',
              summary: 'New login detected from unfamiliar location',
              action: 'Verify login was you, update password if needed',
              context: [
                'Login detected: December 14, 2025 at 9:42 AM MST',
                'Location: Phoenix, Arizona - IP: 192.168.xxx.xxx',
                'Device: Chrome on macOS - If not you, secure your account immediately'
              ]
            },
            {
              id: 'msg008',
              subject: 'December Utility Bill Available - $142.67',
              from: [{ name: 'PNM Utilities', email: 'billing@pnm.com' }],
              receivedAt: new Date(Date.now() - 432000000).toISOString(),
              preview: 'Your December utility bill is ready...',
              category: 'INFORMATIONAL',
              summary: 'December utility bill available',
              action: 'No action needed - AutoPay enabled',
              context: [
                'Total amount due: $142.67 - Due date: December 28, 2025',
                'Usage: 847 kWh (12% higher than last month)',
                'AutoPay scheduled - Payment will process on December 26'
              ]
            },
            {
              id: 'msg009',
              subject: 'Home Assistant December Release Notes',
              from: [{ name: 'Home Assistant', email: 'community@home-assistant.io' }],
              receivedAt: new Date(Date.now() - 518400000).toISOString(),
              preview: 'New features in the latest release...',
              category: 'INFORMATIONAL',
              summary: 'Home Assistant 2024.12 release available',
              action: 'No action needed',
              context: [
                'Version 2024.12 released with Matter 1.3 support',
                'New: Enhanced voice assistant integration with local processing',
                'Breaking changes: Legacy YAML configurations deprecated'
              ]
            }
          ])
        };
        setEmails(mockEmails);
        setLastFetchDates({ yesterday: new Date().toDateString(), week: new Date().toDateString() });
        setLoading(false);
      }, 1500);
      return;
    }

    try {
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const yesterdayStart = new Date(todayStart);
      yesterdayStart.setDate(yesterdayStart.getDate() - 1);
      const weekStart = new Date(todayStart);
      weekStart.setDate(weekStart.getDate() - 7);

      // Always fetch today's emails
      const todayEmails = await fetchEmails(todayStart, now);
      const todayClassified = normalizeEmails(await classifyEmails(todayEmails));

      // Check if we need to fetch yesterday's emails
      let yesterdayClassified = emails.yesterday;
      const shouldFetchYesterday = !lastFetchDates.yesterday || 
        lastFetchDates.yesterday !== todayStart.toDateString();
      
      if (shouldFetchYesterday) {
        const yesterdayEmails = await fetchEmails(yesterdayStart, todayStart);
        yesterdayClassified = normalizeEmails(await classifyEmails(yesterdayEmails));
      }

      // Check if we need to fetch past week's emails
      let weekClassified = emails.week;
      const shouldFetchWeek = !lastFetchDates.week || 
        lastFetchDates.week !== todayStart.toDateString();
      
      if (shouldFetchWeek) {
        const weekEmails = await fetchEmails(weekStart, yesterdayStart);
        weekClassified = normalizeEmails(await classifyEmails(weekEmails));
      }

      setEmails({
        today: todayClassified,
        yesterday: yesterdayClassified,
        week: weekClassified
      });

      // Update last fetch dates
      setLastFetchDates({
        yesterday: shouldFetchYesterday ? todayStart.toDateString() : lastFetchDates.yesterday,
        week: shouldFetchWeek ? todayStart.toDateString() : lastFetchDates.week
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const refreshToday = async () => {
    setLoadingToday(true);
    setError(null);

    // Mock data for testing
    if (fastmailApiKey === 'test' && anthropicApiKey === 'test') {
      setTimeout(() => {
        const mockTodayEmails = normalizeEmails([
          {
            id: 'msg001',
            subject: 'Urgent: Medical Appointment Confirmation',
            from: [{ name: 'Desert Health Clinic', email: 'appointments@deserthealthclinic.com' }],
            receivedAt: new Date().toISOString(),
            preview: 'Your appointment is scheduled for tomorrow at 2pm...',
            category: 'ACTIONABLE',
            summary: 'Medical appointment tomorrow at 2pm',
            action: 'Confirm attendance and bring insurance card',
            context: [
              'Appointment scheduled for December 19, 2025 at 2:00 PM',
              'Dr. Sarah Martinez - Annual physical examination',
              'Bring insurance card, ID, and list of current medications'
            ]
          },
          {
            id: 'msg002',
            subject: 'AWS Bill - Payment Method Update Required',
            from: [{ name: 'AWS Billing', email: 'billing@aws.amazon.com' }],
            receivedAt: new Date().toISOString(),
            preview: 'Your payment method needs to be updated...',
            category: 'ACTIONABLE',
            summary: 'AWS payment method needs updating',
            action: 'Update payment information in console',
            context: [
              'Current payment method expires December 31, 2025',
              'Total outstanding balance: $347.82 for December usage',
              'Update required within 48 hours to avoid service interruption'
            ]
          },
          {
            id: 'msg003',
            subject: 'Receipt: Your Purchase at Home Depot #4523',
            from: [{ name: 'Home Depot', email: 'receipts@homedepot.com' }],
            receivedAt: new Date().toISOString(),
            preview: 'Thank you for your purchase...',
            category: 'INFORMATIONAL',
            summary: 'Home Depot purchase receipt - $127.43',
            action: 'No action needed',
            context: [
              'Purchase total: $127.43 on December 18, 2025',
              'Items: LED shop lights, electrical supplies, hardware',
              'Store #4523, Albuquerque, NM - Transaction #TA2345678'
            ]
          }
        ]);
        setEmails(prev => ({ ...prev, today: mockTodayEmails }));
        setLoadingToday(false);
      }, 1000);
      return;
    }

    try {
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

      const todayEmails = await fetchEmails(todayStart, now);
      const todayClassified = normalizeEmails(await classifyEmails(todayEmails));

      setEmails(prev => ({ ...prev, today: todayClassified }));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingToday(false);
    }
  };

  useEffect(() => {
    if (fastmailApiKey && anthropicApiKey) {
      loadEmails();
    }
  }, []);

  const tabs = [
    { id: 'today', label: 'Today', icon: Clock },
    { id: 'yesterday', label: 'Yesterday', icon: Calendar },
    { id: 'week', label: 'Past Week', icon: Mail }
  ];

  const normalizeCategory = (category) => {
    const map = {
      MOST_IMPORTANT: 'ACTIONABLE',
      MODERATELY_IMPORTANT: 'INFORMATIONAL'
    };
    return map[category] || category;
  };

  const normalizeEmails = (emailList = []) =>
    emailList.map(email => ({
      ...email,
      category: normalizeCategory(email.category)
    }));

  const getCategoryColor = (category) => {
    return category === 'ACTIONABLE' 
      ? 'bg-red-50 border-red-200 hover:border-red-300'
      : 'bg-amber-50 border-amber-200 hover:border-amber-300';
  };

  const getCategoryBadge = (category) => {
    return category === 'ACTIONABLE'
      ? 'bg-red-100 text-red-700 border-red-300'
      : 'bg-amber-100 text-amber-700 border-amber-300';
  };

  const currentEmails = emails[activeTab] || [];
  const actionableEmails = currentEmails.filter(e => e.category === 'ACTIONABLE');
  const informationalEmails = currentEmails.filter(e => e.category === 'INFORMATIONAL');

  const handleSendMessage = async () => {
    if (!chatInput.trim()) return;

    const userMessage = { role: 'user', content: chatInput };
    setChatMessages(prev => [...prev, userMessage]);
    setChatInput('');

    // Mock AI response for testing
    setTimeout(() => {
      const aiMessage = { 
        role: 'assistant', 
        content: 'I can help you with your email triage! You can ask me about specific emails, request summaries, or get help understanding what actions are needed.'
      };
      setChatMessages(prev => [...prev, aiMessage]);
    }, 1000);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-800 via-slate-900 to-slate-800 p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <h1 className="text-3xl font-bold text-white">
              Mail Triage
            </h1>
            {configSaved && (
              <button
                onClick={loadEmails}
                disabled={loading}
                className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-medium shadow-lg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Loading...
                  </>
                ) : (
                  <>
                    <Mail className="w-5 h-5" />
                    Load Emails
                  </>
                )}
              </button>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-6 bg-slate-800 p-2 rounded-2xl border border-slate-700 shadow-xl">
          {tabs.map(tab => {
            const Icon = tab.icon;
            const isToday = tab.id === 'today';
            const isActive = activeTab === tab.id;
            
            return (
              <button
                key={tab.id}
                onMouseDown={() => {
                  if (isToday && isActive) {
                    setTodayPressed(true);
                  }
                }}
                onMouseUp={() => {
                  if (isToday && isActive) {
                    setTimeout(() => setTodayPressed(false), 150);
                  }
                }}
                onMouseLeave={() => setTodayPressed(false)}
                onClick={() => {
                  if (isToday && isActive) {
                    refreshToday();
                  } else {
                    setActiveTab(tab.id);
                  }
                }}
                className={`flex-1 flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-medium transition-all duration-150 ${
                  isActive
                    ? `bg-blue-600 text-white ${
                        todayPressed && isToday
                          ? 'shadow-[inset_0_2px_4px_rgba(0,0,0,0.3),0_1px_0_rgba(255,255,255,0.1)] bg-blue-700'
                          : 'shadow-lg'
                      }`
                    : 'text-slate-400 hover:bg-slate-700 hover:text-white'
                }`}
              >
                {loadingToday && isToday && isActive ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Icon className="w-4 h-4" />
                )}
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Content */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 bg-slate-800 rounded-2xl border border-slate-700">
            <Loader2 className="w-12 h-12 text-blue-500 animate-spin mb-4" />
            <p className="text-slate-400">Analyzing your emails...</p>
          </div>
        ) : error ? (
          <div className="bg-red-900/30 border border-red-700 rounded-2xl p-6 text-red-400">
            <AlertCircle className="w-6 h-6 inline mr-2" />
            {error}
          </div>
        ) : (
          <div className="space-y-6">
            {/* Actionable */}
            {actionableEmails.length > 0 && (
              <div>
                <h2 className="text-lg font-semibold text-red-400 mb-3 flex items-center gap-2">
                  <AlertCircle className="w-5 h-5" />
                  Actionable ({actionableEmails.length})
                </h2>
                <div className="space-y-3">
                  {actionableEmails.map((email, idx) => (
                    <div
                      key={idx}
                      className={`${getCategoryColor(email.category)} rounded-2xl border p-5 shadow-lg hover:shadow-xl transition-all duration-200`}
                    >
                      <div className="flex items-start justify-between gap-4 mb-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className={`text-xs font-semibold px-2 py-1 rounded-md border ${getCategoryBadge(email.category)}`}>
                              {email.category.replace('_', ' ')}
                            </span>
                          </div>
                          <h3 className="font-bold text-gray-900 text-lg mb-1">
                            {email.subject}
                          </h3>
                          <p className="text-sm text-gray-600 mb-2">
                            From: <span className="font-medium">{email.from?.[0]?.name || email.from?.[0]?.email || 'Unknown'}</span>
                          </p>
                        </div>
                        <a
                          href={`https://www.fastmail.com/mail/Inbox/${email.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex-shrink-0 p-2 hover:bg-white/50 rounded-lg transition-colors"
                          title="Open in Fastmail"
                        >
                          <ExternalLink className="w-5 h-5 text-gray-600" />
                        </a>
                      </div>
                      
                      <div className="bg-white/50 rounded-xl p-4 mb-3">
                        <p className="text-sm font-semibold text-gray-900 mb-2">{email.summary}</p>
                        {email.context && email.context.length > 0 && (
                          <div className="space-y-1.5">
                            {email.context.map((line, i) => (
                              <div key={i} className="flex items-start gap-2">
                                <div className="w-1 h-1 rounded-full bg-gray-400 mt-2 flex-shrink-0"></div>
                                <p className="text-sm text-gray-700">{line}</p>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                      
                      <div className="bg-white/70 rounded-xl px-4 py-2.5">
                        <p className="text-sm text-gray-900">
                          <span className="font-semibold">Action:</span> {email.action}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Informational */}
            {informationalEmails.length > 0 && (
              <div>
                <h2 className="text-lg font-semibold text-amber-400 mb-3 flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5" />
                  Informational ({informationalEmails.length})
                </h2>
                <div className="space-y-3">
                  {informationalEmails.map((email, idx) => (
                    <div
                      key={idx}
                      className={`${getCategoryColor(email.category)} rounded-2xl border p-5 shadow-lg hover:shadow-xl transition-all duration-200`}
                    >
                      <div className="flex items-start justify-between gap-4 mb-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className={`text-xs font-semibold px-2 py-1 rounded-md border ${getCategoryBadge(email.category)}`}>
                              {email.category.replace('_', ' ')}
                            </span>
                          </div>
                          <h3 className="font-bold text-gray-900 text-lg mb-1">
                            {email.subject}
                          </h3>
                          <p className="text-sm text-gray-600 mb-2">
                            From: <span className="font-medium">{email.from?.[0]?.name || email.from?.[0]?.email || 'Unknown'}</span>
                          </p>
                        </div>
                        <a
                          href={`https://www.fastmail.com/mail/Inbox/${email.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex-shrink-0 p-2 hover:bg-white/50 rounded-lg transition-colors"
                          title="Open in Fastmail"
                        >
                          <ExternalLink className="w-5 h-5 text-gray-600" />
                        </a>
                      </div>
                      
                      <div className="bg-white/50 rounded-xl p-4 mb-3">
                        <p className="text-sm font-semibold text-gray-900 mb-2">{email.summary}</p>
                        {email.context && email.context.length > 0 && (
                          <div className="space-y-1.5">
                            {email.context.map((line, i) => (
                              <div key={i} className="flex items-start gap-2">
                                <div className="w-1 h-1 rounded-full bg-gray-400 mt-2 flex-shrink-0"></div>
                                <p className="text-sm text-gray-700">{line}</p>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                      
                      <div className="bg-white/70 rounded-xl px-4 py-2.5">
                        <p className="text-sm text-gray-900">
                          <span className="font-semibold">Action:</span> {email.action}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Empty State */}
            {currentEmails.length === 0 && (
              <div className="text-center py-16 bg-slate-800 rounded-2xl border border-slate-700">
                <Mail className="w-16 h-16 text-slate-600 mx-auto mb-4" />
                <p className="text-slate-300 text-lg font-medium">No important emails for this period</p>
                <p className="text-slate-500 text-sm mt-2">All caught up! 🎉</p>
              </div>
            )}
          </div>
        )}
        
        {/* Settings Widget */}
        {settingsExpanded ? (
          <div className="fixed top-6 right-6 w-96 bg-slate-800 border border-slate-700 rounded-2xl shadow-2xl z-50">
            {/* Settings Header */}
            <div className="flex items-center justify-between p-4 border-b border-slate-700">
              <div className="flex items-center gap-2">
                <Settings className="w-5 h-5 text-blue-500" />
                <h3 className="font-semibold text-white">Configuration</h3>
              </div>
              <button
                onClick={() => setSettingsExpanded(false)}
                className="p-1 hover:bg-slate-700 rounded-lg transition-colors"
              >
                <X className="w-5 h-5 text-slate-400" />
              </button>
            </div>

            {/* Settings Form */}
            <div className="p-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  AI Model
                </label>
                <select
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-slate-600 bg-slate-900 text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="gpt-4o-mini">GPT-4o Mini (OpenAI)</option>
                  <option value="haiku-4.5">Haiku 4.5 (Anthropic)</option>
                </select>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Fastmail API Key
                </label>
                <div className="relative">
                  <input
                    type={showFastmailKey ? "text" : "password"}
                    value={fastmailApiKey}
                    readOnly
                    className="w-full px-4 py-3 pr-12 rounded-xl border border-slate-600 bg-slate-900 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                  <button
                    type="button"
                    onClick={() => setShowFastmailKey(!showFastmailKey)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1 hover:bg-slate-700 rounded transition-colors"
                  >
                    {showFastmailKey ? (
                      <EyeOff className="w-5 h-5 text-slate-400" />
                    ) : (
                      <Eye className="w-5 h-5 text-slate-400" />
                    )}
                  </button>
                </div>
              </div>
              
              {selectedModel === 'haiku-4.5' && (
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    Anthropic API Key
                  </label>
                  <div className="relative">
                    <input
                      type={showAnthropicKey ? "text" : "password"}
                      value={anthropicApiKey}
                      readOnly
                      className="w-full px-4 py-3 pr-12 rounded-xl border border-slate-600 bg-slate-900 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                    <button
                      type="button"
                      onClick={() => setShowAnthropicKey(!showAnthropicKey)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 p-1 hover:bg-slate-700 rounded transition-colors"
                    >
                      {showAnthropicKey ? (
                        <EyeOff className="w-5 h-5 text-slate-400" />
                      ) : (
                        <Eye className="w-5 h-5 text-slate-400" />
                      )}
                    </button>
                  </div>
                </div>
              )}
              
              {selectedModel === 'gpt-4o-mini' && (
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    OpenAI API Key
                  </label>
                  <div className="relative">
                    <input
                      type={showOpenaiKey ? "text" : "password"}
                      value={openaiApiKey}
                      readOnly
                      className="w-full px-4 py-3 pr-12 rounded-xl border border-slate-600 bg-slate-900 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                    <button
                      type="button"
                      onClick={() => setShowOpenaiKey(!showOpenaiKey)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 p-1 hover:bg-slate-700 rounded transition-colors"
                    >
                      {showOpenaiKey ? (
                        <EyeOff className="w-5 h-5 text-slate-400" />
                      ) : (
                        <Eye className="w-5 h-5 text-slate-400" />
                      )}
                    </button>
                  </div>
                </div>
              )}

              <button
                onClick={saveConfig}
                className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-medium shadow-lg transition-all duration-200"
              >
                Save
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setSettingsExpanded(true)}
            className="fixed top-6 right-6 p-3 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl shadow-xl transition-all duration-200 z-50"
          >
            <Settings className="w-5 h-5 text-slate-300" />
          </button>
        )}
        
        {/* Chat Widget */}
        {chatOpen ? (
          <div className="fixed bottom-6 right-6 w-96 h-[600px] bg-slate-800 border border-slate-700 rounded-2xl shadow-2xl flex flex-col z-50">
            {/* Chat Header */}
            <div className="flex items-center justify-between p-4 border-b border-slate-700">
              <div className="flex items-center gap-2">
                <MessageCircle className="w-5 h-5 text-blue-500" />
                <h3 className="font-semibold text-white">Email Assistant</h3>
              </div>
              <button
                onClick={() => setChatOpen(false)}
                className="p-1 hover:bg-slate-700 rounded-lg transition-colors"
              >
                <X className="w-5 h-5 text-slate-400" />
              </button>
            </div>

            {/* Chat Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {chatMessages.length === 0 ? (
                <div className="text-center text-slate-400 mt-8">
                  <MessageCircle className="w-12 h-12 mx-auto mb-3 text-slate-600" />
                  <p className="text-sm">Ask me anything about your emails!</p>
                </div>
              ) : (
                chatMessages.map((msg, idx) => (
                  <div
                    key={idx}
                    className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[80%] rounded-2xl px-4 py-2 ${
                        msg.role === 'user'
                          ? 'bg-blue-600 text-white'
                          : 'bg-slate-700 text-slate-200'
                      }`}
                    >
                      <p className="text-sm">{msg.content}</p>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Chat Input */}
            <div className="p-4 border-t border-slate-700">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
                  placeholder="Ask about your emails..."
                  className="flex-1 px-4 py-2 rounded-xl border border-slate-600 bg-slate-900 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                />
                <button
                  onClick={handleSendMessage}
                  className="p-2 bg-blue-600 hover:bg-blue-700 rounded-xl transition-colors"
                >
                  <Send className="w-5 h-5 text-white" />
                </button>
              </div>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setChatOpen(true)}
            className="fixed bottom-6 right-6 p-4 bg-blue-600 hover:bg-blue-700 rounded-full shadow-2xl transition-all duration-200 hover:scale-110 z-50"
          >
            <MessageCircle className="w-6 h-6 text-white" />
          </button>
        )}
      </div>
    </div>
  );
};

export default FastmailTriage;
