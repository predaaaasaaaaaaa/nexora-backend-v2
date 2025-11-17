import { supabase } from '../services/supabase.js';

// Submit feedback
export async function submitFeedback(req, res) {
  try {
    const { rating, message, category } = req.body;
    const userId = req.user.id;

    if (!rating || !message) {
      return res.status(400).json({
        success: false,
        error: 'Rating and message are required'
      });
    }

    const { data, error } = await supabase
      .from('feedback')
      .insert({
        user_id: userId,
        rating: rating,
        notes: message,
        helpful: rating >= 4,
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) throw error;

    res.json({
      success: true,
      message: 'Thank you for your feedback!',
      data: data
    });

  } catch (error) {
    console.error('Error submitting feedback:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

