FROM public.ecr.aws/lambda/nodejs:14

# Assumes your function is named "app.js", and there is a package.json file in the app directory 
COPY app.js ${LAMBDA_TASK_ROOT}
COPY package.json ${LAMBDA_TASK_ROOT}
COPY utils/twilio.js ${LAMBDA_TASK_ROOT}/utils/twilio.js
COPY services/open-table.js ${LAMBDA_TASK_ROOT}/services/open-table.js
COPY services/resy.js ${LAMBDA_TASK_ROOT}/services/resy.js

# Install NPM dependencies for function
RUN corepack enable
RUN corepack prepare pnpm@6.32.3 --activate
RUN pnpm install

# # Set the CMD to your handler (could also be done as a parameter override outside of the Dockerfile)
CMD [ "app.handler" ]  