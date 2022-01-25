import twilio from 'twilio';
import { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER, TWILIO_TO_NUMBER } from '../config/twilio';

export function sendTwilioMessage(body) {
  const client = new twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
  return client.messages
    .create({
      body,
      to: TWILIO_TO_NUMBER,
      from: TWILIO_FROM_NUMBER,
    })
    .then((message) => logger.log(`Text message successfully sent: ${message.sid}`));
}
