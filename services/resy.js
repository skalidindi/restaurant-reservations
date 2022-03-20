import got from 'got';
import dayjs from 'dayjs';
import { sendTwilioMessage } from '../utils/twilio';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import isBetween from 'dayjs/plugin/isBetween';
dayjs.extend(customParseFormat);
dayjs.extend(isBetween);

const {
  START_DATE,
  END_DATE,
  DAYS_IN_WEEK,
  MIN_HOUR,
  MAX_HOUR,
  PARTY_SIZE,
  RANKED_PREFERRED_TIMES,
  RESY_API_KEY,
  RESY_AUTH_TOKEN,
  RESY_VENUE_ID,
  RESY_VENUE_NAME,
} = process.env;

const TIME_FORMAT = 'HH:mm:ss';

function createResyClient() {
  const client = got.extend({
    prefixUrl: 'https://api.resy.com',
    headers: {
      authorization: `ResyAPI api_key="${RESY_API_KEY}"`,
      'x-resy-universal-auth': RESY_AUTH_TOKEN,
      'user-agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/97.0.4692.71 Safari/537.36',
    },
  });

  return client;
}

async function fetchAvailableDates() {
  const client = createResyClient();
  const { scheduled } = await client('4/venue/calendar', {
    searchParams: {
      start_date: START_DATE,
      end_date: END_DATE,
      num_seats: PARTY_SIZE,
      venue_id: RESY_VENUE_ID,
    },
  }).json();

  return scheduled
    ? scheduled.filter((schedule) => schedule.inventory.reservation === 'available').map((schedule) => schedule.date)
    : [];
}

async function fetchAvailabilitiesForDate(date) {
  const client = createResyClient();
  const availabilities = await client('4/find', {
    searchParams: {
      lat: 0,
      long: 0,
      day: date,
      party_size: PARTY_SIZE,
      venue_id: RESY_VENUE_ID,
    },
  }).json();

  return availabilities;
}

async function fetchFilteredAvailabilities() {
  const availableDates = await fetchAvailableDates();
  let availabilities = [];
  for (const date of availableDates) {
    const {
      results: { venues },
    } = await fetchAvailabilitiesForDate(date);
    const datesTimes = (venues?.[0] || []).slots.filter((slot) => {
      const dateTime = slot.date.start;
      const dayObject = dayjs(dateTime);
      const day = dayObject.day();
      const DAYS_IN_WEEK_ARRAY = DAYS_IN_WEEK.split(',').map((num) => parseInt(num.trim(), 10));
      return (
        DAYS_IN_WEEK_ARRAY.includes(day) &&
        dayObject.isBetween(dayObject.hour(MIN_HOUR), dayObject.hour(MAX_HOUR), 'minute', '[]')
      );
    });
    availabilities = availabilities.concat(datesTimes);
  }

  return availabilities;
}

async function fetchBookingDetails(configId, day, partySize) {
  const client = createResyClient();
  const {
    book_token: { value },
    user: {
      payment_methods: [payment],
    },
  } = await client('3/details', {
    searchParams: {
      config_id: configId,
      day,
      party_size: partySize,
    },
  }).json();

  return {
    bookToken: value,
    paymentId: payment.id,
  };
}

async function bookReservationSlot(bookToken, paymentId) {
  const client = createResyClient();

  const reservationDetails = await client.post('3/book', {
    form: {
      book_token: bookToken,
      struct_payment_method: JSON.stringify({ id: paymentId }),
      source_id: 'resy.com-venue-details',
    },
  });

  return reservationDetails;
}

function getPreferredAvailability(availabilities) {
  const RANKED_PREFERRED_TIMES_ARRAY = RANKED_PREFERRED_TIMES.split(',').map((time) => time.trim());
  for (const rankedPreferredTime of RANKED_PREFERRED_TIMES_ARRAY) {
    const preferredAvailability = availabilities.find(({ date: { start } }) => {
      const time = dayjs(start).format(TIME_FORMAT);
      return time === rankedPreferredTime;
    });
    if (preferredAvailability) {
      return preferredAvailability;
    }
  }

  // If no preferred times are matched exactly, return the time closest to first preference
  const firstPreferredTime = RANKED_PREFERRED_TIMES_ARRAY[0];
  const startTimeDifferenceBetweenFirstPreferredTime = availabilities.map(({ date: { start } }) =>
    // Format date time i.e '2022-01-28 18:00:00' into time i.e '18:00:00' and then parse as dayjs object
    Math.abs(dayjs(dayjs(start).format(TIME_FORMAT), TIME_FORMAT).diff(dayjs(firstPreferredTime, TIME_FORMAT))),
  );
  const min = Math.min(...startTimeDifferenceBetweenFirstPreferredTime);

  return availabilities[startTimeDifferenceBetweenFirstPreferredTime.indexOf(min)];
}

export default async function resy() {
  const availabilities = await fetchFilteredAvailabilities();
  if (availabilities.length > 0) {
    const {
      config: { token },
      date: { start },
    } = getPreferredAvailability(availabilities);
    const foundMessage = `We found a reservation on ${dayjs(start)}`;
    sendTwilioMessage(foundMessage);
    console.log(foundMessage);
    const bookingDetails = await fetchBookingDetails(token, dayjs(start).format('YYYY-MM-DD'), PARTY_SIZE);
    const { reservation_id } = await bookReservationSlot(bookingDetails.bookToken, bookingDetails.paymentId);
    const bookedMessage = `We booked your reservation for ${RESY_VENUE_NAME} at ${dayjs(
      start,
    )} with id ${reservation_id}`;
    console.log(bookedMessage);
    sendTwilioMessage(bookedMessage);
    return true;
  } else {
    console.log('No availabilities found');
    return false;
  }
}
