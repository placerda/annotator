import React from 'react';
import ReactDOM from 'react-dom';
import dicomParser from 'dicom-parser';
import './index.css';

/****************************************************************************/
/* Top-level component that has Slice and the Toolbox controlled components */
/****************************************************************************/  
class Workingbox extends React.Component {

    constructor(props){
      super(props);
      
      // initialize state variables
      this.state = {history: [],  // history: [{contours: [ [[x1, y1],[x2, y2],[x3, y3]], [[x1, y1],[x2, y2]] ], currentContourIdx: 1}]}
                    pixelDataHU: [],
                    pixelDataGray: [],      
                    dicomLoaded: false,   
                    dicomFilename: '-',      
                    windowCenter: null,
                    windowWidth: null,     
                    width: 512,
                    height: 512,
                    xPos: null,
                    yPos: null} 

      // bindings
      this.addPoint = this.addPoint.bind(this);
      this.updateCoordinates = this.updateCoordinates.bind(this);      
      this.undoHistory = this.undoHistory.bind(this)
      this.handleKeyDown = this.handleKeyDown.bind(this)      
      this.getCurrentContours = this.getCurrentContours.bind(this)
      this.getIntensity = this.getIntensity.bind(this)
      this.incrementContours = this.incrementContours.bind(this)
      this.loadDicom = this.loadDicom.bind(this)
    }

    handleKeyDown(e){
      if(e.keyCode === 27) {
        // Esc
        this.undoHistory()
      } else if (e.keyCode === 78){
        //Ctrl + N 
        this.incrementContours()
      }
    }

    componentDidMount(){
      document.addEventListener("keydown", this.handleKeyDown, false);
    }

    componentWillUnmount(){
      document.removeEventListener("keydown", this.handleKeyDown, false);
    }

    undoHistory(){
      const history = this.state.history
      this.setState({history: history.slice(0,-1), dicomDrawn: false})
    }

    incrementContours() {
      const history = this.state.history
      console.log(history)
      if (history.length > 0){
        const lastHistory = history[history.length-1]
        const currentContourIdx = lastHistory.currentContourIdx
        const currentContour = lastHistory.contours[currentContourIdx]
        if (currentContour && isContourValid(currentContour)){
          // only increments a new contour if the current one is valid.
          const newContourIdx = currentContourIdx+1
          this.setState({history: history.concat({contours: lastHistory.contours.slice(), currentContourIdx: newContourIdx})})
        }
      }
    }

    addPoint(x, y){
      if (this.state.pixelDataGray.length === 0){
        console.log('please upload DICOM file')
        return 0;
      } 
      const history = this.state.history
      let contours = []
      if (history.length === 0){
        // first point ever
        contours = [[[x,y]]]
        this.setState({history: history.concat({contours: contours, currentContourIdx: 0})})
      } else {
        const lastHistory = history[history.length-1]
        const currentContourIdx =  lastHistory.currentContourIdx
        let contours = lastHistory.contours.slice()
        if (currentContourIdx === (lastHistory.contours.length-1)){
          // current contour is the last contour
          contours[currentContourIdx] = contours[currentContourIdx].concat([[x, y]])
        } else {
          // current contour is a new contour to be created
          contours = contours.concat([[[x, y]]])
        }
        this.setState({history: history.concat({contours: contours, currentContourIdx: currentContourIdx})})
      }
    }

    updateCoordinates(x, y){
      this.setState({xPos: x, yPos: y})
    }

    getCurrentContours(){
      return (this.state.history.length > 0) ? (this.state.history[this.state.history.length-1].contours) : []
    }

    getIntensity(x, y){
      console.log('entrou')
      if ((this.state.pixelDataHU.length !== 0) && (this.state.xPos !== -1) && (this.state.yPos !== -1)){
        const idx = this.state.xPos + (this.state.yPos * this.state.width)
        return this.state.pixelDataHU[idx]
      } else {
        return null
      }
    }

    loadDicom(file){
      const reader = new FileReader()
      const updateDicom = (byteArray, filename) => this.updateDicomImage(byteArray, filename)

      reader.onload = function(e) {
        const arrayBuffer = e.target.result
        const byteArray = new Uint8Array(arrayBuffer)
        updateDicom(byteArray, file.name.slice(0, -4))
      }

      reader.readAsArrayBuffer(file)      
    }

    updateDicomImage(byteArray, filename){

      const dataSet = dicomParser.parseDicom(byteArray/*, options */)
      const pixelDataElement = dataSet.elements.x7fe00010
      const rows = parseInt(dataSet.uint16('x00280010'))
      const columns = parseInt(dataSet.uint16('x00280011'))
      const windowCenter = parseFloat(dataSet.string('x00281050'))
      const windowWidth = parseFloat(dataSet.string('x00281051'))
      const rescaleIntercept = parseInt(dataSet.string('x00281052'))
      const rescaleSlope = parseInt(dataSet.string('x00281053'))
  
      
      // Converts to 16-bit array because DICOM bits allocated is 16-bit.
      // Important: needs to divide length by two since each 2 bytes makes a 16-bit pixel.
      //            https://github.com/cornerstonejs/dicomParser/issues/73#issuecomment-404851437
      const pixelDataUint16 = new Uint16Array(dataSet.byteArray.buffer, pixelDataElement.dataOffset, pixelDataElement.length / 2)
      const pixelDataHU = Int32Array.from(pixelDataUint16, (x) => (x * rescaleSlope) + rescaleIntercept)
      const pixelDataGray = this.quantize(pixelDataHU, windowCenter, windowWidth)
      // const pixelDataRGBA = this.grayscaleToRGBA(pixelDataGray)

      this.setState({history: [], pixelDataHU: pixelDataHU, pixelDataGray: pixelDataGray, dicomLoaded: true, 
                    windowCenter: windowCenter, windowWidth: windowWidth, dicomFilename: filename, width: columns, height: rows})
    }

    quantize(huArray, windowCenter, windowWidth){
      const huMin = windowCenter - 0.5 * windowWidth
      const huMax = windowCenter + 0.5 * windowWidth
      const truncated = huArray.map((x) => (x>huMax)?huMax:(x<huMin)?huMin:x)
      return Uint8Array.from(truncated, (x) => ( ((x-huMin) * 255)/windowWidth) )
    }

    grayscaleToRGBA(pixelDataGray){
      let rgba = new Uint8ClampedArray(this.state.width * this.state.height * 4)
      for (let i = 0; i < pixelDataGray.length; i++){
        const idx = i * 4
        rgba[idx] = pixelDataGray[i]
        rgba[idx+1] = pixelDataGray[i]
        rgba[idx+2] = pixelDataGray[i]                
        rgba[idx+3] = 1
      }
      return rgba
    }
  
    render() {
      return (
        <div className="annotator">
          <div className="titlebox">DICOM Annotator App</div>
          <div className="workingbox">
            <Slice history={this.state.history} width={this.state.width} height={this.state.height} 
                   fileName={this.state.dicomFilename} pixelDataGray={this.state.pixelDataGray} dicomLoaded={this.state.dicomLoaded}
                  onAddPoint={this.addPoint} onMouseMove={this.updateCoordinates}/>
            <Toolbox wc={this.state.windowCenter} ww={this.state.windowWidth} xPos={this.state.xPos} yPos={this.state.yPos} 
                     fileName={this.state.dicomFilename} hu= {this.getIntensity()} currentContours={this.getCurrentContours()} 
                     onAnnotationDownlod={this.incrementContours} onUploadFile={this.loadDicom}/>
          </div>
          <div className="footerbox">
              Mouse left-click: annotate<br />
              Esc: undo <br />
              N: create new annotation
          </div>
        </div>
      );
    }
    
  }
  
  /************************************************/
  /* Slice component is where all drawing happens */
  /************************************************/
  class Slice extends React.Component {

    constructor(props){
      super(props)
      this.handleMouseDown = this.handleMouseDown.bind(this)
      this.handleMouseMove = this.handleMouseMove.bind(this)
      this.handleMouseUp = this.handleMouseUp.bind(this)
      this.state = {
        drawing: false,
        imageData: null,
        fileName: null
      }
    }

    componentDidUpdate() {
      this.draw()
    }

    draw(){
      const canvas = this.refs.canvas
      const ctx = canvas.getContext("2d")
      
      // draw image
      if (this.props.dicomLoaded){
        ctx.clearRect(0, 0, canvas.width, canvas.height)

        if ((this.state.imageData != null) && (this.state.fileName === this.props.fileName)){
          // if image has already been drawn, it is reused.
          ctx.putImageData(this.state.imageData, 0, 0)
        }else{
          // if it is the first time after the image is loaded we draw it ***
          const pixelDataGray = this.props.pixelDataGray
          for(let x = 0; x < canvas.width; x++){
            for (let y = 0; y < canvas.height; y++){
              const idx = (y * canvas.width) + x
              ctx.fillStyle = "rgba("+pixelDataGray[idx]+","+pixelDataGray[idx]+","+pixelDataGray[idx]+","+1+")"
              ctx.fillRect(x, y, 1, 1)
            }
          }
          const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          this.setState({imageData: imgData, fileName: this.props.fileName})
        }
      } 
      // TODO: Need to refactor in *** to use putImageData based on pixelDataRGBA instead of painting each pixel
      // Reference: https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Pixel_manipulation_with_canvas

      // draw contours
      const history = this.props.history

      if (history.length > 0){
        const historyNumber = history.length-1         
        const contours = history[historyNumber].contours
        const currentContourIdx = history[historyNumber].currentContourIdx

        ctx.strokeStyle = "red"
        ctx.fillStyle = "red"
  
        for (let i = 0; i < contours.length; i++){  
          // draw the contour lines
          ctx.beginPath()
          const contour = contours[i]
          ctx.moveTo(contour[0][0], contour[0][1])
          ctx.fillRect(contour[0][0], contour[0][1], 1, 1 ) // draws contours' first pixel
  
          for (let j = 0; j < contour.length; j++){
            ctx.lineTo(contour[j][0], contour[j][1])
          }
  
          // closes the contour if it isn't the last one
          if (i !== currentContourIdx)
            ctx.lineTo(contour[0][0], contour[0][1])
  
          ctx.stroke();
          ctx.closePath();
        }

      } 
      

    }
      
    handleMouseDown(e){
      if (e.button ===0)
        this.setState({drawing: true})
    }

    handleMouseMove(e){
      const canvas = this.refs.canvas
      const rect = canvas.getBoundingClientRect()
      let x = e.clientX - rect.left
      x = Math.min(Math.max(parseInt(x), 0), canvas.width-1) // hack to keep value between bondaries
      let y = e.clientY - rect.top
      y = Math.min(Math.max(parseInt(y), 0), canvas.height-1) // hack to keep value between bondaries
      this.props.onMouseMove(x, y)
      if (this.state.drawing){
        this.props.onAddPoint(x, y)
      }
    }

    handleMouseUp(e){
      if (e.button === 0){
        const canvas = this.refs.canvas
        const rect = canvas.getBoundingClientRect()
        const x = e.clientX - rect.left
        const y = e.clientY - rect.top
        this.props.onAddPoint(x, y)
        this.setState({drawing: false})
      }
    }

    render(){
      return (
        <div className="slice">
          <canvas ref="canvas" width={this.props.width} height={this.props.height} className="slice-canvas"  
                  // onContextMenu={(e)=> {e.preventDefault()}} 
                  onMouseMove={this.handleMouseMove} 
                  onMouseDown={this.handleMouseDown} 
                  onMouseUp={this.handleMouseUp} />
          <img ref="dicom" className="hidden" />
        </div>      
      )
    }

  }

  /*******************************************************/
  /* Toolbox component where the summary and buttons are */
  /*******************************************************/
  class Toolbox extends React.Component{
    constructor(props){
      super(props)
      this.fileInput = React.createRef()
      this.handleDownloadAnnotationClick = this.handleDownloadAnnotationClick.bind(this)
      this.handleUploadFile = this.handleUploadFile.bind(this)
    }
    
    handleDownloadAnnotationClick(e){
      const contours = this.props.currentContours.filter(isContourValid)
      if (contours.length > 0){
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(contours))
        const element = document.createElement("a")
        element.setAttribute("href",     dataStr     )
        element.setAttribute("download", (this.props.fileName + ".json"))
        element.click()
        this.props.onAnnotationDownlod()
      }
    }

    handleUploadFile(e){
      const files = this.fileInput.current.files
      if (files.length > 0){        
        const file = files[0]
        this.props.onUploadFile(file)
      }
    }

    render(){
      return (
        <div className="toolbox">
          <div className="summary">
            <div>{this.props.fileName}</div>             
            <div>x: {this.props.xPos}</div>
            <div>y: {this.props.yPos}</div>
            <div>hu: {this.props.hu}</div>           
            <div>wc: {this.props.wc}</div>    
            <div>ww: {this.props.ww}</div>                
          </div>
          <div className="upload-dicom-button">
              <button onClick={() => this.fileInput.current.click()}>Upload Dicom File</button>
              <input type="file" onChange={this.handleUploadFile} ref={this.fileInput} style={{ display: "none" }} />
          </div>
          <div className="download-annotation-button">
              <button onClick={this.handleDownloadAnnotationClick}>Download Annotation</button>
          </div>                    
          
          {/* TODO: Add load segmentation option */}
          {/* <div className="upload-annotation-button">upload annotation</div> */}
        </div>
      )
    }
  }

  ReactDOM.render(
    <Workingbox />,
    document.getElementById('root')
  );


/* general utility */
function isContourValid(contour){
  return (contour.length < 3)?false:true
}