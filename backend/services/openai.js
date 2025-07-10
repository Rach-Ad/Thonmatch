const OpenAI = require('openai');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// South Sudanese cultural context for AI responses
const CULTURAL_CONTEXT = `
You are an AI assistant specialized in South Sudanese culture and dating. 
South Sudan has over 60 tribes including Dinka, Nuer, Shilluk, Bari, Azande, and many others.
The country values family, respect for elders, community, and traditional customs.
Many South Sudanese live in diaspora communities in USA, Australia, Canada, Kenya, and Uganda.
Be respectful of cultural diversity within South Sudan and avoid stereotypes.
Focus on meaningful connections, family values, and cultural pride.
`;

const TRIBES = [
  'Dinka', 'Nuer', 'Shilluk', 'Bari', 'Azande', 'Acholi', 'Anyuak', 'Avukaya',
  'Balanda Bviri', 'Balanda Boor', 'Boya', 'Didinga', 'Jie', 'Kakwa', 'Kuku',
  'Lotuko', 'Mandari', 'Mundari', 'Murle', 'Pojulu', 'Taposa', 'Toposa', 'Zande'
];

const RELIGIONS = ['Christian', 'Catholic', 'Protestant', 'Traditional', 'Muslim', 'Other'];

class OpenAIService {
  async generateDatingBio(profileData) {
    try {
      const { name, age, tribe, location, religion, familyValues, interests, education } = profileData;

      const prompt = `${CULTURAL_CONTEXT}

Create a warm and authentic dating bio for a South Sudanese person with these details:
- Name: ${name}
- Age: ${age}
- Tribe: ${tribe}
- Location: ${location}
- Religion: ${religion}
- Family Values: ${familyValues}
- Interests: ${interests || 'Not specified'}
- Education: ${education || 'Not specified'}

Write a 2-3 sentence bio that:
1. Reflects their cultural pride and values
2. Shows their personality
3. Mentions what they're looking for in a partner
4. Sounds natural and authentic

Keep it under 150 words and make it engaging for potential matches.`;

      const response = await openai.chat.completions.create({
        model: "gpt-4",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 200,
        temperature: 0.8,
      });

      return response.choices[0].message.content.trim();
    } catch (error) {
      console.error('Error generating bio:', error);
      return `Hi! I'm ${profileData.name}, a proud ${profileData.tribe} from ${profileData.location}. I value family, culture, and meaningful connections. Looking for someone who shares similar values and is ready for a genuine relationship.`;
    }
  }

  async generateIcebreakers(userProfile, matchProfile) {
    try {
      const sharedInterests = this.findSharedInterests(userProfile, matchProfile);
      const culturalConnections = this.findCulturalConnections(userProfile, matchProfile);

      const prompt = `${CULTURAL_CONTEXT}

Generate 3 culturally-aware icebreaker messages for a South Sudanese dating app.

User Profile:
- Name: ${userProfile.name}
- Tribe: ${userProfile.tribe}
- Location: ${userProfile.location}
- Interests: ${userProfile.interests || 'Not specified'}

Match Profile:
- Name: ${matchProfile.name}
- Tribe: ${matchProfile.tribe}
- Location: ${matchProfile.location}
- Interests: ${matchProfile.interests || 'Not specified'}

Shared connections: ${sharedInterests.length > 0 ? sharedInterests.join(', ') : 'None obvious'}
Cultural connections: ${culturalConnections}

Create 3 different icebreaker messages that:
1. Reference South Sudanese culture respectfully
2. Show genuine interest in getting to know them
3. Are warm and friendly but not overly casual
4. Each should be 1-2 sentences and under 100 characters

Format as a simple list.`;

      const response = await openai.chat.completions.create({
        model: "gpt-4",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 300,
        temperature: 0.9,
      });

      const icebreakers = response.choices[0].message.content
        .trim()
        .split('\n')
        .filter(line => line.trim())
        .map(line => line.replace(/^\d+\.\s*/, '').trim())
        .slice(0, 3);

      return icebreakers;
    } catch (error) {
      console.error('Error generating icebreakers:', error);
      return [
        `Hi ${matchProfile.name}! I see you're from ${matchProfile.location}. How are you finding life there?`,
        `Hello! I noticed we're both ${this.findCulturalConnections(userProfile, matchProfile)}. What's your favorite tradition?`,
        `Hi! Your profile caught my attention. I'd love to know more about your interests!`
      ];
    }
  }

  async provideDatingAdvice(context, userMessage) {
    try {
      const prompt = `${CULTURAL_CONTEXT}

You're a dating coach for South Sudanese singles. Provide helpful, culturally-sensitive advice.

Context: ${context}
User's question/situation: ${userMessage}

Provide advice that:
1. Respects South Sudanese cultural values
2. Encourages authentic connections
3. Is practical and actionable
4. Considers both traditional and modern dating approaches
5. Is supportive and encouraging

Keep response under 200 words.`;

      const response = await openai.chat.completions.create({
        model: "gpt-4",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 250,
        temperature: 0.7,
      });

      return response.choices[0].message.content.trim();
    } catch (error) {
      console.error('Error providing dating advice:', error);
      return "I'm here to help! Remember to be authentic, respectful, and patient in your dating journey. Building meaningful connections takes time, and the right person will appreciate your genuine self.";
    }
  }

  async suggestDateIdea(userProfile, matchProfile, location) {
    try {
      const prompt = `${CULTURAL_CONTEXT}

Suggest a culturally-appropriate date idea for two South Sudanese people.

User Profile:
- Tribe: ${userProfile.tribe}
- Location: ${userProfile.location}
- Interests: ${userProfile.interests || 'Not specified'}

Match Profile:
- Tribe: ${matchProfile.tribe}
- Location: ${matchProfile.location}
- Interests: ${matchProfile.interests || 'Not specified'}

Their location: ${location}

Suggest a date idea that:
1. Respects cultural values and traditions
2. Allows for meaningful conversation
3. Is appropriate for their location (diaspora or South Sudan)
4. Considers their shared interests
5. Is feasible and practical

Keep it to 2-3 sentences.`;

      const response = await openai.chat.completions.create({
        model: "gpt-4",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 150,
        temperature: 0.8,
      });

      return response.choices[0].message.content.trim();
    } catch (error) {
      console.error('Error suggesting date idea:', error);
      return "Consider meeting for coffee or tea in a comfortable public place where you can have a good conversation and get to know each other better.";
    }
  }

  findSharedInterests(profile1, profile2) {
    const interests1 = (profile1.interests || '').toLowerCase().split(',').map(i => i.trim());
    const interests2 = (profile2.interests || '').toLowerCase().split(',').map(i => i.trim());
    return interests1.filter(interest => interests2.includes(interest));
  }

  findCulturalConnections(profile1, profile2) {
    const connections = [];
    
    if (profile1.tribe === profile2.tribe) {
      connections.push(`both ${profile1.tribe}`);
    }
    
    if (profile1.religion === profile2.religion) {
      connections.push(`sharing ${profile1.religion} faith`);
    }
    
    if (profile1.location === profile2.location) {
      connections.push(`both living in ${profile1.location}`);
    }
    
    return connections.length > 0 ? connections.join(' and ') : 'seeking meaningful cultural connections';
  }
}

module.exports = new OpenAIService();