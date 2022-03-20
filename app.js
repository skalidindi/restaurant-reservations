import resyHandler from './services/resy';
import openTableHandler from './services/open-table';

const { RESTAURANT_TYPE } = process.env;

export const handler = async () => {
  if (RESTAURANT_TYPE === 'RESY') {
    await resyHandler();
  } else if (RESTAURANT_TYPE === 'OPEN_TABLE') {
    await openTableHandler();
  } else {
    console.error(`RESTAURANT_TYPE is not set!`);
  }
  return null;
};
