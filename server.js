const express = require('express');
const cors = require('cors');
const app = express();
const fs = require('fs');

const multer = require('multer');
const upload = multer();

app.use(cors());
const port = 3001;
const unirest = require("unirest");


app.get('/authenticate', (req, res) => {
  const {username, password} = req.query;
  console.log(username, password);
  const request = unirest("POST", "https://t3.automationedge.com/aeengine/rest/authenticate")
                  .query({username, password });
                  request.end(function (response) {
                    if (response.error) {
                        console.error(response.error);
                        res.status(500).send('Error occurred');
                      } else {
                        res.json(response.body);
                      }
                  });

});

app.post('/upload', upload.array('files', 2), async (req, res) => {
  const { files } = req;
  const sessionToken = req.body.sessionToken;
  console.log(files, sessionToken);

  // Uploading file1 to the t3 server
  const response1 = await unirest.post("https://t3.automationedge.com/aeengine/rest/file/upload")
                                 .headers({ 'Content-Type': 'multipart/form-data', 'X-Session-Token': sessionToken })
                                 .query({'workflow_name': 'InputFileTest', 'workflow_id': '22825'})
                                 .attach('file', files[0].buffer, { filename: files[0].originalname })
  
  const fileId1 = response1.body.fileId;

  //uploading file2 to the t3 server
  const response2 = await unirest.post("https://t3.automationedge.com/aeengine/rest/file/upload")
                                 .headers({ 'Content-Type': 'multipart/form-data', 'X-Session-Token': sessionToken })
                                 .query({'workflow_name': 'InputFileTest', 'workflow_id': '22825'})
                                 .attach('file', files[1].buffer, { filename: files[1].originalname })
 
  const fileId2 = response2.body.fileId;

  console.log(fileId1, fileId2);

  // Executing workflow with input files
  await unirest.post("https://t3.automationedge.com/aeengine/rest/execute")
               .headers({ 'Content-Type': 'application/json', 'X-Session-Token': sessionToken })
               .query({'workflow_name': 'InputFileTest', 'workflow_id': '22825'})
               .send(
                  {"orgCode":"VAIBHAV_PARADHI_2113","workflowName":"InputFileTest",
                  "userId":"Vaibhav Paradhi", "source":"Rest Test","responseMailSubject":"null",
                  "params":[{"name": "input_file", "value":fileId1, "type": "File"},
                  {"name": "input_file1", "value":fileId2, "type": "File"}]}
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

  const {sessionToken, requestId} = req.query;
  
  let status = 'pending';
  let fileName = '';
  let fileValue = '';
  let request_id = '';

  // Checking Workflow status after every 3 seconds

  while (status !== 'Complete') {
    console.log(sessionToken, requestId);
    const request = await unirest("GET", `https://t3.automationedge.com/aeengine/rest/workflowinstances/${requestId}`)
                            .headers({ 'Content-Type': 'application/json', 'X-Session-Token': sessionToken })
                            .end(function (response) {
                              console.log(response.body);
                                if (response.error) {
                                  console.error(response.error);
                                  res.status(500).send(response.error);
                                } else {
                                    status = response.body.status;
                                    if (response.body.workflowResponse) {
                                        fileName = JSON.parse(response.body.workflowResponse).outputParameters[0].name;
                                        fileValue = JSON.parse(response.body.workflowResponse).outputParameters[0].value;
                                        console.log(fileName);
                                        console.log(fileValue);
                                        }
                                        request_id = response.body.id;
                                  }
                            });
                            await new Promise(resolve => setTimeout(resolve, 3000)); 
  };

  
  
  //output file - to download
await unirest.get("https://t3.automationedge.com/aeengine/rest/file/download")
             .headers({'X-Session-Token': sessionToken })
             .query({'file_id': fileValue, 'request_id': requestId,})
             .end(function (response) {
              console.log("File downloaded");
               if (response.error) {
                  console.error(response.error);
                  res.status(500).send('Error occurred during file download.');
                 } else {
                  const fileBuffer = response.body;
                  res.setHeader('Content-disposition', 'attachment; filename=' + fileName);
                  res.setHeader('Content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
                  res.send(fileBuffer);
                 }
             });

});


app.listen(port, () => {
  console.log(`Server app listening at http://localhost:${port}`);
});

