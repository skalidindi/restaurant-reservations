FROM public.ecr.aws/lambda/nodejs:14
# Alternatively, you can pull the base image from Docker Hub: amazon/aws-lambda-nodejs:12

# Assumes your function is named "app.js", and there is a package.json file in the app directory 
COPY app.js ${LAMBDA_TASK_ROOT}
COPY package.json ${LAMBDA_TASK_ROOT}
COPY utils ${LAMBDA_TASK_ROOT}
COPY services ${LAMBDA_TASK_ROOT}

# Install NPM dependencies for function
RUN corepack enable
RUN corepack prepare pnpm@6.32.3 --activate
RUN pnpm install

# # Set the CMD to your handler (could also be done as a parameter override outside of the Dockerfile)
CMD [ "app.handler" ]  