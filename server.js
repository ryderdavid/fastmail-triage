import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Anthropic API proxy endpoint
app.post('/api/anthropic/messages', async (req, res) => {
  try {
    console.log('Anthropic API request received');
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(req.body)
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Anthropic API error response:', data);
      return res.status(response.status).json(data);
    }

    res.json(data);
  } catch (error) {
    console.error('Anthropic API error:', error);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

// OpenAI API proxy endpoint
app.post('/api/openai/chat/completions', async (req, res) => {
  try {
    console.log('OpenAI API request received');
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify(req.body)
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('OpenAI API error response:', data);
      return res.status(response.status).json(data);
    }

    console.log('OpenAI API request successful');
    res.json(data);
  } catch (error) {
    console.error('OpenAI API error:', error);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

// Fastmail API proxy endpoint
app.post('/api/fastmail', async (req, res) => {
  try {
    console.log('Fastmail API request received');
    
    // Fetch the correct accountId from the JMAP session
    const sessionResponse = await fetch('https://api.fastmail.com/jmap/session', {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.FASTMAIL_API_KEY}`
      }
    });
    
    const session = await sessionResponse.json();
    const accountId = session.primaryAccounts?.['urn:ietf:params:jmap:mail'];
    
    if (!accountId) {
      return res.status(500).json({ error: 'Could not determine accountId from session', session });
    }
    
    // Inject the accountId into method calls
    const requestBody = { ...req.body };
    if (requestBody.methodCalls) {
      requestBody.methodCalls = requestBody.methodCalls.map(call => {
        const [method, params, id] = call;
        if (params && typeof params === 'object') {
          return [method, { ...params, accountId }, id];
        }
        return call;
      });
    }

    const response = await fetch('https://api.fastmail.com/jmap/api/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.FASTMAIL_API_KEY}`
      },
      body: JSON.stringify(requestBody)
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Fastmail API error response:', data);
      return res.status(response.status).json(data);
    }

    console.log('Fastmail API request successful');
    res.json(data);
  } catch (error) {
    console.error('Fastmail API error:', error);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Backend server running on http://localhost:${PORT}`);
  console.log('Environment check:');
  console.log('- ANTHROPIC_API_KEY:', process.env.ANTHROPIC_API_KEY ? `${process.env.ANTHROPIC_API_KEY.substring(0, 10)}...` : 'NOT SET');
  console.log('- OPENAI_API_KEY:', process.env.OPENAI_API_KEY ? `${process.env.OPENAI_API_KEY.substring(0, 10)}...` : 'NOT SET');
  console.log('- FASTMAIL_API_KEY:', process.env.FASTMAIL_API_KEY ? `${process.env.FASTMAIL_API_KEY.substring(0, 10)}...` : 'NOT SET');
  console.log('- FASTMAIL_ACCOUNT:', process.env.FASTMAIL_ACCOUNT || 'NOT SET');
});
