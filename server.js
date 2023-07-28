const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const app = express();


// setting build 

app.use(express.static(path.join(__dirname, '../project_ui/build')));

app.get('/', function (req, res) {
  res.sendFile(path.join(__dirname, '../project_ui/build', 'index.html'));
});


//logging - winston
const winston = require("winston");
const logger = winston.createLogger({

  level: "info",
  //standard log format
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(
      (info) => `${info.timestamp} ${info.level}: ${info.message}`
    )
  ),
  // Log to the console and a file
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: "logs/app.log" }),
  ],
});

const multer = require('multer');
const upload = multer();

app.use(cors());
const port = 8080;
const unirest = require("unirest");


app.get('/authenticate', (req, res) => {
  const {username, password} = req.query;
  logger.info(`Received a ${req.method} request for ${req.url}`);
  const request = unirest("POST", "https://t4.automationedge.com/aeengine/rest/authenticate")
                  .query({username, password });
                  request.end(function (response) {
                    console.log(response.body)
                    if (response.error) {
                        console.log(response.error)
                        logger.error(`${response.error.message} from t3 instance`);
                        res.status(401).send('Error occurred');
                      } else {
                        logger.info(`Session Token Received from t3 instance`);
                        res.status(200).json(response.body);
                      }
                  });

});

app.post('/upload', upload.array('files', 2), async (req, res) => {
  logger.info(`Received a ${req.method} request for to upload a file.`)
  const { files } = req;
  const sessionToken = req.body.sessionToken;
  const tenant_name = req.body.tenantName;
  const tenant_orgcode = req.body.tenantOrgCode;
  const mailId = req.body.mailId;

  console.log(sessionToken, tenant_name, tenant_orgcode);

  // Uploading file1 to the t3 server
  const response1 = await unirest.post("https://t4.automationedge.com/aeengine/rest/file/upload")
                                 .headers({ 'Content-Type': 'multipart/form-data', 'X-Session-Token': sessionToken })
                                 .query({'workflow_name': 'GSTR_2B_1', 'workflow_id': '4339'})
                                 .attach('file', files[0].buffer, { filename: files[0].originalname })
  
  const fileId1 = response1.body.fileId;

  //uploading file2 to the t3 server
  const response2 = await unirest.post("https://t4.automationedge.com/aeengine/rest/file/upload")
                                 .headers({ 'Content-Type': 'multipart/form-data', 'X-Session-Token': sessionToken })
                                 .query({'workflow_name': 'GSTR_2B_1', 'workflow_id': '4339'})
                                 .attach('file', files[1].buffer, { filename: files[1].originalname })
 
  const fileId2 = response2.body.fileId;

  console.log(fileId1, fileId2);

  // Executing workflow with input files
  await unirest.post("https://t4.automationedge.com/aeengine/rest/execute")
               .headers({ 'Content-Type': 'application/json', 'X-Session-Token': sessionToken })
               .query({'workflow_name': 'GSTR_2B_1', 'workflow_id': '4339'})
               .send(
                {"orgCode": tenant_orgcode,"workflowName":"GSTR_2B_1",
                "userId": tenant_name, "source":"Rest Test","responseMailSubject":"null",
                "params":[{"name": "Input_File", "value":fileId1, "type": "File"},
                {"name": "GST_File_Path", "value":fileId2, "type": "File"}, 
                {"name": "Destination_Address", "value": mailId, "type": "String"}]}
                )
               .end(function (response) {
                  if (response.error) {
                      console.error(response.error);
                      res.status(500).send('Error occurred while executing worfkflow');
                    } else {
                      res.json(response.body.automationRequestId);
                    }
                });
  });


app.get('/status', async (req, res) => {
  logger.info(`Received a ${req.method} request for ${req.url} to check status`);
  const {sessionToken, requestId} = req.query;
  
  let status = 'pending';
  let fileName = '';
  let fileValue = '';
  let request_id = '';

  // Checking Workflow status after every 3 seconds
  let counter = 0;

  while (status !== 'Complete' && status !== 'Failure') {
    console.log(sessionToken, requestId);
    const request = await unirest("GET", `https://t4.automationedge.com/aeengine/rest/workflowinstances/${requestId}`)
                            .headers({ 'Content-Type': 'application/json', 'X-Session-Token': sessionToken })
                            .end(function (response) {
                              console.log(response.body);
                                if (response.error) {
                                  console.log(response.error);
                                  res.status(500).send(response.error);
                                } else {
                                    status = response.body.status;
                                    if (response.body.workflowResponse) {
                                        fileName = JSON.parse(response.body.workflowResponse).outputParameters[0].name;
                                        fileValue = JSON.parse(response.body.workflowResponse).outputParameters[0].value;
                                        }
                                        request_id = response.body.id;
                                  }
                                  if (status === 'New' && !response.body.agentName) {
                                            counter++;
                                            if (counter === 10) {
                                                status = 'no_agent';
                                                }
                                  } else {
                                            counter = 0;
                                  }
                                  
                            });
                            if (status === 'Complete' || status === 'Failure' || status === 'no_agent') {
                              break;
                            }
                            
                            await new Promise(resolve => setTimeout(resolve, 3000)); 
  };

      if (status === 'Complete') {
        res.status(200).send({ status: 'Complete ! Please Check Your Mail' });
          } else if (status === 'Failure') {
        res.status(200).send({ status: 'Failure ! Please Try Again (Check Input Files)' });
        } else if (status === 'no_agent') {
          res.status(200).send({status: 'Contact the Administrator Agent Is Under Maintainance'});
        }
  
  
// output file - to download
// await unirest
// .get("https://t3.automationedge.com/aeengine/rest/file/download")
// .headers({ 'X-Session-Token': sessionToken })
// .query({ 'file_id': fileValue, 'request_id': requestId })
// .end(function (response) {
  
//   if (response.error) {
//     console.error(response.error);
//     res.status(500).send('Error occurred during file download.');
//   } else {
//     const fileBuffer = response.raw_body;
//     const fileName = 'product_output.xlsx'; 
//     const filePath = path.join(__dirname, 'downloads', fileName); 

//     fs.writeFile(filePath, fileBuffer, 'binary', function (err) {
//       if (err) {
//         console.error(err);
//         res.status(500).send('Error occurred while saving the file.');
//       } else {
//         console.log('File downloaded and saved:', fileName);
//         res.setHeader('Content-Disposition', 'attachment; filename=' + fileName);
//         res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
//         res.sendFile(filePath);
//       }
//     });
//   }
// });

});


app.listen(port, () => {
  console.log(`Server app listening at http://10.41.11.10:${port}`);
});

