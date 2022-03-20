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
  OPEN_TABLE_AUTH_TOKEN,
  OPEN_TABLE_GLOBAL_PID,
  OPEN_TABLE_RESTAURANT_ID,
  OPEN_TABLE_VENUE_NAME,
  TWILIO_TO_NUMBER,
} = process.env;

const TIME_FORMAT = 'HH:mm:ss';

function createOpenTableClient() {
  const client = got.extend({
    prefixUrl: 'https://mobile-api.opentable.com',
    headers: {
      'user-agent': 'com.context optional.OpenTable/15.2.0.16; iPhone; iOS/15.1.1; 3.0;',
      'content-type': 'application/json',
      Authorization: `Bearer ${OPEN_TABLE_AUTH_TOKEN}`,
      Cookie: `OT-Session-Update-Date="${dayjs().unix()}"`,
    },
  });

  return client;
}

async function fetchAvailableDates() {
  const client = createOpenTableClient();
  const { suggestedAvailability } = await client
    .put(`api/v3/restaurant/availability`, {
      json: {
        forceNextAvailable: true,
        includeNextAvailable: true,
        dateTime: dayjs().format('YYYY-MM-DDTHH:mm'),
        attribution: {
          partnerId: '84',
        },
        partySize: PARTY_SIZE,
        rids: [OPEN_TABLE_RESTAURANT_ID],
      },
    })
    .json();
  return suggestedAvailability;
}

async function fetchFilteredAvailabilities() {
  const availableDates = (await fetchAvailableDates()) ?? [];
  const filteredAvailabileDates = availableDates.filter(({ dateTime, timeslots }) => {
    const dayObject = dayjs(dateTime);
    const day = dayObject.day();
    const DAYS_IN_WEEK_ARRAY = DAYS_IN_WEEK.split(',').map((num) => parseInt(num.trim(), 10));
    return (
      DAYS_IN_WEEK_ARRAY.includes(day) &&
      timeslots?.length > 0 &&
      dayObject.isBetween(dayjs(START_DATE), dayjs(END_DATE), 'day', '[]')
    );
  });

  return filteredAvailabileDates.flatMap((availableDate) => {
    return (availableDate?.timeslots ?? []).filter(({ dateTime }) => {
      const dayObject = dayjs(dateTime);
      return dayObject.isBetween(dayObject.hour(MIN_HOUR), dayObject.hour(MAX_HOUR), 'minute', '[]');
    });
  });
}

function getPreferredAvailability(availabilities) {
  const RANKED_PREFERRED_TIMES_ARRAY = RANKED_PREFERRED_TIMES.split(',').map((time) => time.trim());
  for (const rankedPreferredTime of RANKED_PREFERRED_TIMES_ARRAY) {
    const preferredAvailability = availabilities.find(({ dateTime }) => {
      const time = dayjs(dateTime).format(TIME_FORMAT);
      return time === rankedPreferredTime;
    });
    if (preferredAvailability) {
      return preferredAvailability;
    }
  }

  // If no preferred times are matched exactly, return the time closest to first preference
  const firstPreferredTime = RANKED_PREFERRED_TIMES_ARRAY[0];
  const startTimeDifferenceBetweenFirstPreferredTime = availabilities.map(({ dateTime }) =>
    // Format date time i.e '2022-01-28 18:00:00' into time i.e '18:00:00' and then parse as dayjs object
    Math.abs(dayjs(dayjs(dateTime).format(TIME_FORMAT), TIME_FORMAT).diff(dayjs(firstPreferredTime, TIME_FORMAT))),
  );
  const min = Math.min(...startTimeDifferenceBetweenFirstPreferredTime);

  return availabilities[startTimeDifferenceBetweenFirstPreferredTime.indexOf(min)];
}

async function lockBooking(dateTime, slotHash, PARTY_SIZE) {
  const client = createOpenTableClient();
  const lock = await client
    .post(`api/v1/reservation/${OPEN_TABLE_RESTAURANT_ID}/lock`, {
      json: {
        partySize: PARTY_SIZE,
        dateTime,
        hash: slotHash,
      },
    })
    .json();
  return lock;
}

async function bookReservationSlot(dateTime, slotHash, slotAvailabilityToken, lockId) {
  const client = createOpenTableClient();
  const reservationDetails = await client
    .post(`api/v1/reservation/${OPEN_TABLE_RESTAURANT_ID}`, {
      json: {
        partySize: PARTY_SIZE,
        gpid: OPEN_TABLE_GLOBAL_PID,
        countryId: 'US',
        attribution: {
          partnerId: '84',
        },
        occasion: 'anniversary',
        loyaltyProgramOptIn: true,
        rewardTier: 'GreatDeal',
        hash: slotHash,
        points: 1000,
        loadInvitations: false,
        number: TWILIO_TO_NUMBER,
        notes: '',
        slotAvailabilityToken,
        selectedDiningArea: {
          diningAreaId: '1',
          tableAttribute: 'default',
        },
        lockId,
        location: {
          latitude: 0,
          longitude: 0,
        },
        dateTime,
      },
    })
    .json();
  return reservationDetails;
}

export default async function openTable() {
  const availabilities = await fetchFilteredAvailabilities();
  if (availabilities.length > 0) {
    const { dateTime, slotHash, token } = getPreferredAvailability(availabilities);
    const foundMessage = `We found a reservation on ${dayjs(dateTime)}`;
    sendTwilioMessage(foundMessage);
    console.log(foundMessage);
    const { id } = await lockBooking(dateTime, slotHash, PARTY_SIZE);
    console.log(`We successfully locked a reservation with lock id ${id}`);
    const { confirmationNumber } = await bookReservationSlot(dateTime, slotHash, token, id);
    const bookedMessage = `We booked your reservation for ${OPEN_TABLE_VENUE_NAME} at ${dayjs(
      dateTime,
    )} with id ${confirmationNumber}`;
    console.log(reservationDetails);
    sendTwilioMessage(bookedMessage);
    return true;
  } else {
    console.log('No availabilities found');
    return false;
  }
}
